// server/server.js

const express = require('express');
const app = express();
app.use(express.static('public'));
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);

const debug = true;

const PORT = 3000;

// ============ SÉCURITÉ : validation des entrées ============
// Nettoie le pseudo : supprime les balises/caractères dangereux (anti-XSS) et limite la longueur
// Nettoie un pseudo fourni par le client avant tout usage (anti-XSS) :
// retire les balises et les caractères dangereux.
// Param : raw {*} pseudo brut reçu du client.
// Retour : {string} pseudo sûr, max 20 caractères ; 'Joueur' si vide/invalide.
function sanitizeUsername(raw) {
	if (typeof raw !== 'string') return 'Joueur';
	let name = raw.replace(/<[^>]*>/g, '').replace(/[<>&"'`]/g, '').trim();
	if (!name) name = 'Joueur';
	return name.slice(0, 20);
}

const VALID_TEAMS = ['A', 'B'];
const VALID_DIRECTIONS = ['up', 'down', 'left', 'right'];
const ROOM_ID_RE = /^[A-Za-z0-9_-]{1,64}$/; // Ids de salle WebRTC : alphanumériques uniquement

// Vérifie qu'une valeur est un nombre fini (évite NaN / Infinity dans la géométrie)
// Param : v {*} — Retour : {boolean} true si v est un nombre exploitable.
function isFiniteNumber(v) {
	return typeof v === 'number' && Number.isFinite(v);
}
// =========================================================

let nbPlayers = 0; // Nb de joueurs VIVANTS
let gameInProgress = false;
let launcherId = 0;
let demoStartedAt = 0; // Date de lancement de la partie démo en cours (0 = pas de démo)
let voiceChatEnabled = false; // Chans vocaux activés par l'host pour la partie en cours
const voiceRoster = { A: [], B: [] }; // Membres du chan vocal de chaque équipe

// Ajoutez un objet pour stocker les points de vie des joueurs
const players = {};
const waiters = {};

const maxLP = 8;
const maxAM = 6;

const maxFramesHurt = 10;

const map = {
	width: 1600, // x4 : 800 * 2
	height: 800  // x4 : 400 * 2
};

const mapDiag = Math.sqrt(Math.pow(map.width,2) + Math.pow(map.height,2));

// Layout de base d'un quadrant (800x400), dupliqué en 2x2 pour couvrir 1600x800
const BASE_OBSTACLES = [
	{ x: 25, y: 25, w: 25, h: 100 },
	{ x: 50, y: 25, w: 100, h: 25 },
	{ x: 290, y: 300, w: 25, h: 100 },
	{ x: 290, y: 0, w: 25, h: 100 },
	{ x: 165, y: 25, w: 50, h: 25 },
	{ x: 550, y: 275, w: 25, h: 100 },
	{ x: 250, y: 150, w: 100, h: 100 },
	{ x: 450, y: 350, w: 100, h: 25 },
	{ x: 25, y: 175, w: 25, h: 100 },
	{ x: 50, y: 215, w: 75, h: 20 },
	{ x: 134, y: 103, w: 43, h: 66 },
	{ x: 445, y: 141, w: 20, h: 109 },
	{ x: 379, y: 46, w: 147, h: 19 },
	{ x: 557, y: 115, w: 55, h: 57 },
	{ x: 667, y: 38, w: 22, h: 84 },
	{ x: 716, y: 142, w: 44, h: 23 },
	{ x: 577, y: 0, w: 34, h: 51 },
	{ x: 626, y: 356, w: 28, h: 44 },
	{ x: 131, y: 347, w: 49, h: 54 },
	{ x: 686, y: 241, w: 114, h: 13 },
	{ x: 616, y: 239, w: 59, h: 10 },
	{ x: 379, y: 291, w: 37, h: 29 },
	{ x: 505, y: 287, w: 49, h: 4 },
	{ x: 346, y: 158, w: 39, h: 6 },
	{ x: 346, y: 237, w: 33, h: 5 },
];
// Variations : ids de BASE_OBSTACLES ignorés par quadrant (0,0) (1,0) (0,1) (1,1)
const QUAD_SKIPS = [ [], [23,24,26], [24,25], [9,19,27,28] ];
const QUAD_W = 800, QUAD_H = 400;
const obstacles = {};
let obstId = 0;
for (let qy = 0; qy < 2; qy++) {
	for (let qx = 0; qx < 2; qx++) {
		const skips = QUAD_SKIPS[qy * 2 + qx];
		BASE_OBSTACLES.forEach((obst, idx) => {
			if (skips.includes(idx)) return;
			obstacles[obstId++] = { x: obst.x + qx * QUAD_W, y: obst.y + qy * QUAD_H, w: obst.w, h: obst.h };
		});
	}
}
// Bordures de la nouvelle carte
obstacles[obstId++] = { x: 0, y: 0, w: map.width, h: 1 };              // ligne du haut
obstacles[obstId++] = { x: 0, y: 0, w: 1, h: map.height };              // ligne de gauche
obstacles[obstId++] = { x: 0, y: map.height - 1, w: map.width, h: 1 };  // ligne du bas
obstacles[obstId++] = { x: map.width - 1, y: 0, w: 1, h: map.height };  // ligne de droite


// En-têtes de sécurité HTTP
app.use((req, res, next) => {
	res.setHeader('X-Content-Type-Options', 'nosniff');
	res.setHeader('X-Frame-Options', 'DENY');
	res.setHeader('Referrer-Policy', 'no-referrer');
	res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; media-src 'self' blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'");
	next();
});
app.use(express.static('client', { dotfiles: 'ignore' }));

// Raccourci : /demo -> page de démo (/demo.html)
app.get('/demo', (req, res) => {
	res.redirect('/demo.html');
});

io.on('connection', (socket) => {
	if (debug) console.log('a user connected, socketId '+socket.id);
	
	//WebRTC
	socket.on('join room', (roomId) => {
		// SÉCURITÉ : id de salle validé, sinon rejet silencieux
		if (typeof roomId !== 'string' || !ROOM_ID_RE.test(roomId)) return;
		socket.join(roomId);
		//console.log(`User ${socket.id} joined room ${roomId}`);
	});

	// SÉCURITÉ : le relais de signalisation ne transmet que des données d'objets validées
	socket.on('offer', (offer, roomId) => {
		if (typeof offer !== 'object' || offer === null || typeof roomId !== 'string' || !ROOM_ID_RE.test(roomId)) return;
		socket.to(roomId).emit('offer', offer);
	});

	socket.on('answer', (answer, roomId) => {
		if (typeof answer !== 'object' || answer === null || typeof roomId !== 'string' || !ROOM_ID_RE.test(roomId)) return;
		socket.to(roomId).emit('answer', answer);
	});

	socket.on('ice candidate', (candidate, roomId) => {
		if (typeof candidate !== 'object' || candidate === null || typeof roomId !== 'string' || !ROOM_ID_RE.test(roomId)) return;
		socket.to(roomId).emit('ice candidate', candidate);
	});

	socket.on('disconnect', () => {
		//console.log('User disconnected:', socket.id);
	});
	//WebRTC
	
	socket.join("next-game");
	
	//console.log(nbPlayers + " player(s)");
	//console.log(avColors[nbPlayers] + " couleur");
	// io.emit('updateTeams', Object.values(players)); // Convertit l'objet en tableau pour l'envoi
	io.emit('updateTeams', Object.values(waiters)); // Convertit l'objet en tableau pour l'envoi
	


	socket.on('start-move', (direction) => {
		// SÉCURITÉ : liste blanche des directions (évite d'écrire des clés arbitraires dans l'objet)
		if (players[socket.id] && VALID_DIRECTIONS.includes(direction)) {
		players[socket.id].movement[direction] = true;
		}
	});

	socket.on('stop-move', (direction) => {
		if (players[socket.id] && VALID_DIRECTIONS.includes(direction)) {
		players[socket.id].movement[direction] = false;
		}
	});

	socket.on('rotate', (mx, my) => {
		// Mettre à jour la position du joueur en fonction de la direction
		const player = players[socket.id];
		// SÉCURITÉ : coordonnées validées (nombres finis)
		if (player && isFiniteNumber(mx) && isFiniteNumber(my)) {
			// Diffuser la nouvelle position à tous les clients
			players[socket.id].angle = Math.atan2(my - player.y - 10, mx - player.x - 10);
			// io.emit('updateAngle', { playerId: socket.id, angle });
		}
	});

	socket.on('disconnect', () => {
		if (debug) console.log('user disconnected');
		const wasPlayer = !!players[socket.id];
		delete waiters[socket.id];
		delete players[socket.id];
		io.emit('updateTeams', Object.values(waiters));
		// Si le lanceur (host) part, on promeut le premier joueur restant :
		// le bouton "Commencer la partie" doit toujours être actif quelque part.
		if (launcherId === socket.id) {
			launcherId = 0;
			const firstId = Object.keys(waiters)[0];
			if (firstId && !gameInProgress) {
				launcherId = firstId;
				io.to(firstId).emit('enableStartButton');
			}
		}
		// Chan vocal : le joueur parti est retiré du roster et de l'écoute de son équipe
		for (const t of ['A', 'B']) {
			const idx = voiceRoster[t].indexOf(socket.id);
			if (idx !== -1) {
				voiceRoster[t].splice(idx, 1);
				socket.to('voice-'+t).emit('voice-peer-left', { id: socket.id });
			}
		}
		if (gameInProgress && wasPlayer) {
			nbPlayers -= 1;
			io.emit('players', players);
			if (debug) console.log("Nbplayers alive "+nbPlayers);
			checkRemainingTeams();
		}
	});

	socket.on('shoot', ({ mouseX, mouseY }) => {
		const player = players[socket.id];
		// SÉCURITÉ : coordonnées validées (nombres finis) et distance non nulle
		if (player && isFiniteNumber(mouseX) && isFiniteNumber(mouseY)) {
			const px = player.x + 10;
			const py = player.y + 10;
			const delX = mouseX - px;
			const delY = mouseY - py;
			
			const DistPM = Math.sqrt(Math.pow(delX,2) + Math.pow(delY,2));
			if (DistPM > 0) {
				const ratio = mapDiag / DistPM;
				const newX = px + ratio*delX;
				const newY = py + ratio*delY;	
				fireBullet(px, py, newX, newY, socket.id);
			}
		}
	});

	socket.on('playerJoin', ({ username, team }) => { // Soumission du form
		// SÉCURITÉ : pseudo nettoyé (anti-XSS), équipe validée par liste blanche
		const safeUsername = sanitizeUsername(username);
		const safeTeam = VALID_TEAMS.includes(team) ? team : 'A';
		waiters[socket.id] = {id: socket.id, username: safeUsername, team: safeTeam}; 
		if (debug) console.log(`${safeUsername} joined Team ${safeTeam} with ${socket.id}`);
		// nbPlayers += 1;
		// console.log(nbPlayers + " player(s)");
		// io.emit('updateTeams', Object.values(players)); // Convertit l'objet en tableau pour l'envoi
		io.emit('updateTeams', Object.values(waiters)); // Convertit l'objet en tableau pour l'envoi
		// Le bouton "Commencer la partie" appartient à un "lanceur" (host) :
		// le premier joueur validé, ou son remplaçant si le précédent est parti.
		// On réémet l'activation à chaque arrivée, tant qu'aucune partie humaine
		// n'est en cours (une démo en cours ne bloque pas le lobby).
		if (!gameInProgress) {
			if (!launcherId || !waiters[launcherId]) {
				launcherId = socket.id;
			}
			io.to(launcherId).emit('enableStartButton');
		}
	});

	socket.on('startGame', ({ voiceChat } = {}) => {
		// Une partie démo en cours est stoppée : la vraie partie prend la main
		if (demoStartedAt) {
			stopDemo();
			io.emit('mapSize', { width: map.width, height: map.height });
		}
		// L'host peut activer les chans vocaux pour cette partie
		voiceChatEnabled = (voiceChat === true);
		voiceRoster.A = [];
		voiceRoster.B = [];
		for (const t of ['A', 'B']) {
			try { io.in('voice-'+t).socketsLeave('voice-'+t); } catch (e) {}
		}
		for (const playerId in players) { // Reinit players, just in case
			delete players[playerId];
		}
		nbPlayers = 0;
		for (const waiterId in waiters) {
			const waiter = waiters[waiterId];
			if (debug) console.log(waiter);
			let player = {};
				player = { id: waiter.id,
					alive: true,
					lifepoints: maxLP,
					ammo: maxAM,
					size:20,
					scores: { hit: 0, kill: 0, ff: 0, fk: 0},
					username: waiter.username, 
					team : waiter.team,
					framesHurt: 0,
					movement: { up: false, down: false, left: false, right: false },
					angle: 0
				};
			if (waiter.team == 'A') {
				player.x = 2;
				player.y = 2;
			}
			else {
				player.x = map.width - 22;
				player.y = map.height - 22;
			}
			players[player.id] = player;
			nbPlayers += 1;
			// Pas sûr qu'il faille supprimer l'item des waiters (pour la partie suivante !)
			// delete waiters[waiterId];
		}
		
		if (debug) console.log(nbPlayers + " player(s)");
		io.emit('mapSize', { width: map.width, height: map.height });
		io.emit('obstacles', obstacles);
		// io.emit('PV', {maxLP, maxAM});
		// console.log("Sending PV "+maxLP+" and Ammo "+maxAM);
		io.emit('players', players);
		if (debug) console.log('Game started');
		gameInProgress = true;
		io.emit('gameStarted', players);
		io.emit('voiceChat', { enabled: voiceChatEnabled }); // lance (ou non) le chan vocal
		// D'autres actions pour démarrer le jeu peuvent être ajoutées ici
		
	});
	
	socket.on("urgentObstacles", () => {
		socket.emit("mapSize", { width: map.width, height: map.height });
		socket.emit("obstacles", obstacles);
	});
	
	socket.on("relaunchGame", () => {
		io.emit("relaunchForAll");
	});

	socket.on("startDemo", () => {
		if (gameInProgress) {
			const humans = Object.keys(players).some(id => !players[id].bot);
			// Une vraie partie (avec joueurs humains) est en cours : on ignore la demande
			if (humans) return;
			// Une partie démo tourne déjà : on la relance proprement pour accueillir le spectateur
			stopDemo();
		}
		startDemo();
	});

	// ==================== Chan vocal d'équipe ====================
	// Deux coéquipiers ne peuvent s'échanger de la signalisation que s'ils
	// sont tous deux inscrits au chan vocal de la même équipe.
	// Indique si deux joueurs sont inscrits au chan vocal de la même équipe
	// (cloisonnement : empêche la signalisation WebRTC inter-équipes).
	// Params : id1, id2 {string} identifiants Socket.IO.
	// Retour : {boolean} true s'ils peuvent s'échanger de la signalisation.
	function sameVoiceTeam(id1, id2) {
		return (voiceRoster.A.includes(id1) && voiceRoster.A.includes(id2)) ||
		       (voiceRoster.B.includes(id1) && voiceRoster.B.includes(id2));
	}

	socket.on('voice-join', () => {
		const player = players[socket.id];
		if (!voiceChatEnabled || !gameInProgress || !player || !player.alive) return;
		if (!VALID_TEAMS.includes(player.team)) return;
		const room = 'voice-' + player.team;
		if (!voiceRoster[player.team].includes(socket.id)) voiceRoster[player.team].push(socket.id);
		socket.join(room);
		// Le nouveau reçoit la liste des membres déjà présents (il lancera les offres)
		socket.emit('voice-joined', { members: voiceRoster[player.team].filter(id => id !== socket.id) });
		// Les membres déjà présents sont prévenus (ils répondront aux offres)
		socket.to(room).emit('voice-peer-joined', { id: socket.id });
	});

	socket.on('voice-offer', ({ to, offer } = {}) => {
		if (typeof to !== 'string' || !offer || typeof offer !== 'object' || !sameVoiceTeam(socket.id, to)) return;
		socket.to(to).emit('voice-offer', { from: socket.id, offer: offer });
	});

	socket.on('voice-answer', ({ to, answer } = {}) => {
		if (typeof to !== 'string' || !answer || typeof answer !== 'object' || !sameVoiceTeam(socket.id, to)) return;
		socket.to(to).emit('voice-answer', { from: socket.id, answer: answer });
	});

	socket.on('voice-ice', ({ to, candidate } = {}) => {
		if (typeof to !== 'string' || !candidate || typeof candidate !== 'object' || !sameVoiceTeam(socket.id, to)) return;
		socket.to(to).emit('voice-ice', { from: socket.id, candidate: candidate });
	});
	// =============================================================
	  		
});

server.listen(PORT, () => {
	console.log('Serveur en écoute sur le port *:3000');
});

// LINE/RECTANGLE
// Teste la collision entre un segment et un rectangle.
// Params : (x1,y1)-(x2,y2) extrémités du segment ; (rx,ry) coin haut-gauche
// du rectangle ; rw/rh sa largeur/hauteur.
// Retour : {test:boolean} ; si test : {dist} distance de (x2,y2) à l'impact
// le plus proche, {intX,intY} coordonnées de ce point d'impact.
function lineRect(x1, y1, x2, y2, rx, ry, rw, rh) {
	// check if the line has hit any of the rectangle's sides
	// uses the Line/Line function below
	
	var hit = false;
	var dist = 10000;
	var intX = 0;
	var intY = 0;

	var left =   lineLine(x1,y1,x2,y2, rx,ry,rx, ry+rh);
	if (left.test) { if (left.dist<dist) { dist=left.dist;hit=true; intX=left.x; intY=left.y;}}
	
	var right =  lineLine(x1,y1,x2,y2, rx+rw,ry, rx+rw,ry+rh);
	if (right.test) { if (right.dist<dist) { dist=right.dist;hit=true; intX=right.x; intY=right.y;}}
	
	var top =    lineLine(x1,y1,x2,y2, rx,ry, rx+rw,ry);
	if (top.test) { if (top.dist<dist) { dist=top.dist;hit=true; intX=top.x; intY=top.y; }}
	
	var bottom = lineLine(x1,y1,x2,y2, rx,ry+rh, rx+rw,ry+rh);
	if (bottom.test) { if (bottom.dist<dist) { dist=bottom.dist;hit=true; intX=bottom.x; intY=bottom.y; }}

	if (hit) {
		return {test:true, dist: dist, intX: intX, intY: intY};
		//return {test:true, x:left.x, y:left.y};
	}
	return {test:false};
}

// LINE/LINE — intersection de deux segments [x1,y1]-[x2,y2] et [x3,y3]-[x4,y4].
// Retour : {test:boolean} ; si test : {x,y} point d'intersection, {dist} sa
// distance à (x2,y2).
function lineLine(x1, y1, x2, y2, x3, y3, x4, y4) {

  // calculate the direction of the lines
  var uA = ((x4-x3)*(y1-y3) - (y4-y3)*(x1-x3)) / ((y4-y3)*(x2-x1) - (x4-x3)*(y2-y1));
  var uB = ((x2-x1)*(y1-y3) - (y2-y1)*(x1-x3)) / ((y4-y3)*(x2-x1) - (x4-x3)*(y2-y1));

  // if uA and uB are between 0-1, lines are colliding
  if (uA >= 0 && uA <= 1 && uB >= 0 && uB <= 1) {

    // optionally, draw a circle where the lines meet
    var intersectionX = x1 + (uA * (x2-x1));
    var intersectionY = y1 + (uA * (y2-y1));
    //	fill(255,0,0);
    //	noStroke();
    //	ellipse(intersectionX, intersectionY, 20, 20);
	var d = Math.sqrt(Math.pow(intersectionY - y2,2) + Math.pow(intersectionX - x2,2));
    return {test:true, x:intersectionX ,y:intersectionY, dist:d };
  }
  return {test:false};
}

// Indique si un objet ne contient aucune propriété propre.
// Param : obj {Object} — Retour : {boolean} true si l'objet est vide.
function isEmpty(obj) {
  for (const prop in obj) {
    if (Object.hasOwn(obj, prop)) {
      return false;
    }
  }
  return true;
}
// Gameloop !!
setInterval(gameUpdate, 1000/60); // 60 fps ;)

// Boucle principale du jeu (~30 ticks/s) : fait vivre l'IA des bots (mode démo),
// décrémente les états "hurt" puis déplace chaque joueur vivant, et diffuse
// positions/angles à tous les clients.
// Params : aucun — Retour : aucun (émet 'updateAnglesAndPositions').
function gameUpdate() {
	if (gameInProgress) updateBots(); // IA des bots du mode démo
	for (const playerId in players) {
		if (players[playerId].alive) {
			if (players[playerId].framesHurt > 0) players[playerId].framesHurt--;
			updatePlayerPosition(playerId);
		}
		// Pas bon parce qu'à 2joueurs, on arrive à du 120fps... et à 3 c'est l'enfer
		// io.emit('updateAngle', { playerId, angle: players[playerId].angle });
		// io.emit('updatePosition', { playerId, position: { x: players[playerId].x, y: players[playerId].y } });	
	}
	io.emit('updateAnglesAndPositions', players);
}

// Applique le déplacement (1 px/tick) d'un joueur selon ses touches actives,
// après annulation des mouvements interdits par adaptMoveToObstacles.
// Param : playerId {string} identifiant Socket.IO du joueur à déplacer.
function updatePlayerPosition(playerId) {
	const player = players[playerId];
	adaptMoveToObstacles(playerId);
	if (player.movement.up) players[playerId].y -= 1;
	if (player.movement.down) players[playerId].y += 1;
	if (player.movement.left) players[playerId].x -= 1;
	if (player.movement.right) players[playerId].x += 1;
}
	
// Annule le déplacement d'un joueur s'il l'amènerait dans un obstacle ou
// hors de la carte (parcourt tous les obstacles à chaque tick).
// Param : playerId {string} identifiant du joueur à contrôler.
function adaptMoveToObstacles(playerId) {
	const player = players[playerId];
	for (const obstacleId in obstacles) {
		const obst = obstacles[obstacleId];
		if (player.movement.up) {
			//tester si le segment player x.y -> x+size.y est en collision avec un obstacle
				if (player.y-1 <= 1 || obst.y+obst.h >= (player.y - 1) && obst.x <= player.x+player.size && obst.x+obst.w >= player.x && obst.y <= player.y+player.size) { players[playerId].y += 1 }
		}
		if (player.movement.left) {
			//tester si le segment player x.y -> x+size.y est en collision avec un obstacle
				if (player.x-1 <= 1 || obst.y+obst.h >= player.y && obst.x <= player.x+player.size && obst.x+obst.w >= (player.x - 1) && obst.y <= player.y+player.size) { players[playerId].x += 1 }
		}
		if (player.movement.down) {
			//tester si le segment player x.y -> x+size.y est en collision avec un obstacle
				if (player.y+player.size+1 >= map.height|| obst.y+obst.h >= player.y && obst.x <= player.x+player.size && obst.x+obst.w >= player.x && obst.y <= player.y+player.size+1) { players[playerId].y -= 1 }
		}
		if (player.movement.right) {
			//tester si le segment player x.y -> x+size.y est en collision avec un obstacle
				if (player.x+player.size+1 >= map.width || obst.y+obst.h >= player.y && obst.x <= player.x+player.size+1 && obst.x+obst.w >= player.x && obst.y <= player.y+player.size) { players[playerId].x -= 1 }
		}
	}
}

// Tue un joueur : alive=false, décrémente le compteur de vivants, coupe son
// micro sur le chan vocal (il continue d'écouter), puis vérifie les équipes.
// Param : playerId {string} identifiant du joueur à tuer.
function killPlayer(playerId) {
	if (debug) console.log("Killing "+playerId);
	players[playerId].alive = false;
	nbPlayers -= 1;
	// Chan vocal : le joueur mort ne peut plus être entendu (il continue d'écouter)
	if (voiceRoster.A.includes(playerId) || voiceRoster.B.includes(playerId)) {
		io.emit('voice-mute', { id: playerId });
	}
	//io.emit('players', players);
	// io.emit('updateTeams', Object.values(waiters));
	if (debug) console.log("Nbplayers alive "+nbPlayers);
	if (nbPlayers <= 1) {
		if (debug) console.log("LastKill -> Endgame");
	}
	checkRemainingTeams();
}

// Clôture la partie : stoppe la boucle de jeu, diffuse les scores et l'équipe
// gagnante ('gameEnded'), et met fin aux chans vocaux.
// Param : winningTeam {string} 'A' ou 'B'.
function endGame(winningTeam) {
	gameInProgress = false;
	if (debug) console.log("Game ended");
	io.emit('gameEnded', {players, launcherId, winningTeam});
	io.emit('voice-chat-end'); // fin du chan vocal
	voiceRoster.A = [];
	voiceRoster.B = [];
	voiceChatEnabled = false;
	// Putting back players in waiters list
}

// Simule un tir complet : cherche le premier obstacle OU joueur touché sur la
// trajectoire origine->cible, inflige les dégâts, diffuse les événements
// d'impact/de trajectoire ('obstTouched', 'drawShoot', 'updateHealth') et
// tue la cible si ses PV tombent à 0.
// Params : px,py {number} origine du tir (centre du tireur) ; mx,my {number}
// point visé ; pid {string} identifiant du tireur.
function fireBullet(px, py, mx, my, pid) {
	
	// foreach obstacles, foreach players
	let odist = 10000;
	let pdist = 10000;
	let toid = "";
	let tpid = "";
	let hitX = 0;
	let hitY = 0;
	for (const obstacleId in obstacles) {
		const obst = obstacles[obstacleId];
		let LR = lineRect(mx,my,px,py, obst.x,obst.y,obst.w,obst.h);
		let hit = LR.test;
		if (hit) {
			if (odist>LR.dist) {
				// console.log("Shot touched obstacle "+obstacleId);
				odist=LR.dist; 
				toid= obstacleId;
				hitX = LR.intX;
				hitY = LR.intY;
			}
		}
		//else fill(0,150,255);
	}
	for (const playerId in players) {
		const play = players[playerId];
		if (playerId !== pid && players[playerId].alive) { // On ne shoote que les joueurs vivants
			let LR = lineRect(mx,my,px,py, play.x,play.y,play.size,play.size);
			let hit = LR.test;
			if (hit) {
				if (pdist>LR.dist) {
					// console.log("Shot touched player "+playerId);
					pdist=LR.dist; 
					tpid= playerId;
					hitX = LR.intX;
					hitY = LR.intY;
				}
			}
		}
	}
	if (odist<pdist) {
		//Obst shot
		io.emit('obstTouched', {x: hitX, y: hitY});
		io.emit("drawShoot", {px, py, hitX, hitY});
	}
	else if (odist>pdist) {
		//Player shot
		players[tpid].lifepoints -= 1;
		players[tpid].framesHurt = maxFramesHurt;
		if (players[tpid].team == players[pid].team) { players[pid].scores.ff += 1; }
		else { players[pid].scores.hit += 1; }
		lp = players[tpid].lifepoints;
		// console.log("Sending updateHealth "+tpid+" "+lp);
		io.emit('updateHealth', {playerId: tpid, health: lp});
		io.emit("drawShoot", {px, py, hitX, hitY});
		if (lp == 0) {
			if (players[tpid].team == players[pid].team) { players[pid].scores.fk += 1; }
			else { players[pid].scores.kill += 1; }
			killPlayer(tpid); 
		}
	}
	// on met les intersections dans un tableau, avec le type d'objet, et la distance avec px py
	// on trie par distance, la plus courte prend l'impact
	// SHOOT io.emit('projectileFired', { x, y, dx, dy });
}
  
// Fonction pour vérifier s'il ne reste qu'une seule équipe active
// Compte les joueurs vivants par équipe ; s'il ne reste zéro ou une seule
// équipe, déclenche endGame avec l'équipe gagnante.
// Params : aucun — Retour : aucun (appelle endGame si nécessaire).
function checkRemainingTeams() {
  // Compter le nombre de joueurs actifs dans chaque équipe
	if (debug) console.log("check R Teams");
	let teamCounts = { A: 0, B: 0 };

	for (let playerId in players) {
		if (players[playerId].alive) {
			let team = players[playerId].team;
			teamCounts[team]++;
		}
	}
	if (debug) console.log(teamCounts);

  // Vérifier s'il ne reste qu'une seule équipe active
	let activeTeams = Object.keys(teamCounts).filter(team => teamCounts[team] > 0);
	if (activeTeams.length === 2) {
		if (debug) console.log("Toujours 2 équipes en jeu");
	} else {
		let winningTeam = activeTeams[0];
		if (debug) console.log(winningTeam+" won");
		endGame(winningTeam);
	}
}

// ============ Mode démo : bots pilotés automatiquement ============
// Déclenché par la page /demo.html (spectateur) via l'événement 'startDemo'.

// Lance une partie démo : vide l'état courant, crée 6 bots (3 contre 3) aux
// coins opposés de la carte avec des noms aléatoires, désactive le chan vocal
// et diffuse l'état initial ('mapSize', 'obstacles', 'players', 'gameStarted').
// Params : aucun — Retour : aucun.
function startDemo() {
	// Nettoyage d'une éventuelle partie précédente
	for (const playerId in players) delete players[playerId];
	for (const waiterId in waiters) delete waiters[waiterId];
	nbPlayers = 0;
	gameInProgress = true;
	const demoNames = pickDemoNames(6);
	for (let i = 0; i < 6; i++) { // 3 contre 3
		const team = (i < 3) ? 'A' : 'B';
		const player = {
			id: 'bot-'+i,
			alive: true,
			lifepoints: maxLP,
			ammo: maxAM,
			size: 20,
			scores: { hit: 0, kill: 0, ff: 0, fk: 0 },
			username: demoNames[i],
			team: team,
			framesHurt: 0,
			movement: { up: false, down: false, left: false, right: false },
			angle: 0,
			bot: {
				index: i,
				moveUntil: 0,
				cooldown: 30 + Math.floor(Math.random()*90),
				waypoint: null,
				waypointAt: 0
			}
		};
		if (team == 'A') { player.x = 2 + (i%3)*40; player.y = 2; }
		else { player.x = map.width - 22 - (i%3)*40; player.y = map.height - 22; }
		players[player.id] = player;
		nbPlayers += 1;
	}
	demoStartedAt = Date.now();
	voiceChatEnabled = false; // pas de chan vocal en démo
	voiceRoster.A = [];
	voiceRoster.B = [];
	io.emit('voiceChat', { enabled: false });
	io.emit('mapSize', { width: map.width, height: map.height });
	io.emit('obstacles', obstacles);
	io.emit('players', players);
	io.emit('gameStarted', players);
	if (debug) console.log(nbPlayers + " bots lancés en mode démo");
}

// Arrête la partie démo : supprime tous les joueurs, remet le serveur au repos
// et notifie les clients (fin du chan vocal).
// Params : aucun — Retour : aucun.
function stopDemo() {
	demoStartedAt = 0;
	for (const playerId in players) delete players[playerId];
	nbPlayers = 0;
	gameInProgress = false;
	voiceChatEnabled = false;
	voiceRoster.A = [];
	voiceRoster.B = [];
	io.emit('voice-chat-end');
}

// Noms aléatoires pour les bots (tirage sans doublon).
// Param : n {number} nombre de noms voulus.
// Retour : {string[]} n noms uniques de la forme 'NOM-XX' (XX aléatoire).
const DEMO_NAME_POOL = ['V1PER','NYX','RAZOR','BOLT','GHOST','FURY','ONYX','ZERO','HAVOC','DELTA','ECHO','FALCON','JINX','KRAIT','QUBIT','MAKO'];
function pickDemoNames(n) {
	const pool = DEMO_NAME_POOL.slice();
	for (let i = pool.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[pool[i], pool[j]] = [pool[j], pool[i]];
	}
	return pool.slice(0, n).map(name => name + '-' + (10 + Math.floor(Math.random()*90)));
}

// Point de recherche personnel : chaque bot fouille sa propre zone de la carte
// (grille 3x2), ce qui force l'équipe à se séparer pour chercher les ennemis.
// Param : index {number} numéro du bot (0 à 5).
// Retour : {{x:number, y:number}} coordonnées monde du waypoint à atteindre.
function pickSearchWaypoint(index) {
	const col = index % 3;
	const row = Math.floor(index / 3) % 2;
	return {
		x: col * (map.width / 3) + 30 + Math.random() * (map.width / 3 - 60),
		y: row * (map.height / 2) + 30 + Math.random() * (map.height / 2 - 60)
	};
}

// Détection : ligne de vue sur les murs uniquement (un coéquipier devant
// ne doit pas empêcher de repérer l'ennemi, seulement de tirer).
// Params : px,py {number} position du bot ; enemy {Object} ennemi (players[id]).
// Retour : {boolean} true si aucun mur ne bloque la vue.
function botSeesEnemy(px, py, enemy) {
	const tx = enemy.x + 10;
	const ty = enemy.y + 10;
	for (const obstacleId in obstacles) {
		const obst = obstacles[obstacleId];
		if (lineRect(px, py, tx, ty, obst.x, obst.y, obst.w, obst.h).test) return false;
	}
	return true;
}

// Vrai ligne de vue pour tirer : ni mur, ni coéquipier sur la trajectoire.
// Params : px,py {number} origine ; tx,ty {number} cible ; shooterId {string},
// shooterTeam {'A'|'B'} tireur (pour exclure ses coéquipiers du test).
// Retour : {boolean} true si le tir est possible sans toucher un allié/mur.
function botHasCleanShot(px, py, tx, ty, shooterId, shooterTeam) {
	for (const obstacleId in obstacles) {
		const obst = obstacles[obstacleId];
		if (lineRect(px, py, tx, ty, obst.x, obst.y, obst.w, obst.h).test) return false;
	}
	for (const playerId in players) {
		const other = players[playerId];
		if (playerId !== shooterId && other.alive && other.team === shooterTeam) {
			if (lineRect(px, py, tx, ty, other.x, other.y, other.size, other.size).test) return false;
		}
	}
	return true;
}

// IA des bots du mode démo (appelée à chaque tick) :
// 1) intel d'équipe : chaque bot repère l'ennemi visible le plus proche,
//    le meilleur contact est partagé à toute l'équipe ;
// 2) coordination : tous les coéquipiers convergent et tirent sur cette cible ;
// 3) recherche : sans contact, chaque bot fouille sa propre zone (waypoint).
// Garde-fou : relance automatique de la partie si elle s'enlise > 2 min.
// Params : aucun — Retour : aucun (modifie players / émet les tirs).
function updateBots() {
	// Garde-fou : si la partie démo s'enlise (aucune issue après 2 min), on la relance
	if (demoStartedAt && (Date.now() - demoStartedAt) > 2*60*1000) {
		if (debug) console.log("Démo bloquée : relance automatique");
		stopDemo();
		startDemo();
		return;
	}

	// ---- Phase 1 : intel d'équipe ----
	// Chaque bot scanne ses ennemis (ligne de vue + rayon de détection).
	// Le meilleur contact de chaque équipe est partagé : toute l'équipe
	// se coordonne sur cette cible unique (focus fire).
	const intel = { A: null, B: null };
	for (const playerId in players) {
		const player = players[playerId];
		if (!player.bot || !player.alive) continue;
		const px0 = player.x + 10;
		const py0 = player.y + 10;
		let spotted = null;
		let spottedDist = Infinity;
		for (const otherId in players) {
			const other = players[otherId];
			if (!other.alive || other.team === player.team) continue;
			const d = Math.hypot(other.x + 10 - px0, other.y + 10 - py0);
			if (d < 450 && d < spottedDist && botSeesEnemy(px0, py0, other)) {
				spotted = other;
				spottedDist = d;
			}
		}
		if (spotted && (!intel[player.team] || spottedDist < intel[player.team].dist)) {
			intel[player.team] = { target: spotted, dist: spottedDist };
		}
	}

	// ---- Phase 2 : action de chaque bot ----
	for (const playerId in players) {
		const player = players[playerId];
		if (!player.bot || !player.alive) continue;
		const b = player.bot;

		// Cible coordonnée : celle que l'équipe a repérée (pas seulement la plus proche de soi)
		const teamIntel = intel[player.team];
		const target = (teamIntel && teamIntel.target.alive) ? teamIntel.target : null;

		// Viser la cible dès qu'elle est repérée
		if (target) player.angle = Math.atan2(target.y - player.y, target.x - player.x);

		// Anti-blocage : si le bot n'a presque pas bougé depuis 0,5 s,
		// la prochaine direction sera purement aléatoire
		if (!b.lastPos) b.lastPos = { x: player.x, y: player.y, frames: 0 };
		b.lastPos.frames++;
		if (b.lastPos.frames >= 30) {
			if (Math.abs(player.x - b.lastPos.x) < 2 && Math.abs(player.y - b.lastPos.y) < 2) {
				b.stuck = true;
				b.moveUntil = 0;
			}
			b.lastPos = { x: player.x, y: player.y, frames: 0 };
		}

		// Déplacement
		if (Date.now() >= b.moveUntil) {
			const dirs = ['up', 'down', 'left', 'right'];
			dirs.forEach(d => player.movement[d] = false);
			let dir;
			if (b.stuck) {
				// Débloquer : direction aléatoire
				dir = dirs[Math.floor(Math.random() * 4)];
			}
			else if (target) {
				// Attaque coordonnée : foncer vers la cible en zigzag (plus dur à toucher)
				const dx = target.x - player.x;
				const dy = target.y - player.y;
				if (Math.abs(dx) > 25 && (Math.abs(dx) > Math.abs(dy) || Math.random() < 0.35)) dir = (dx > 0) ? 'right' : 'left';
				else if (Math.abs(dy) > 25) dir = (dy > 0) ? 'down' : 'up';
				else dir = dirs[Math.floor(Math.random() * 4)]; // très proche : strafe
			}
			else {
				// Recherche : chaque bot file vers son propre waypoint (zones séparées)
				if (!b.waypoint || Date.now() - b.waypointAt > 6000 ||
					(Math.abs(b.waypoint.x - player.x) < 40 && Math.abs(b.waypoint.y - player.y) < 40)) {
					b.waypoint = pickSearchWaypoint(b.index);
					b.waypointAt = Date.now();
				}
				const dx = b.waypoint.x - player.x;
				const dy = b.waypoint.y - player.y;
				if (Math.abs(dx) > Math.abs(dy)) dir = (dx > 0) ? 'right' : 'left';
				else dir = (dy > 0) ? 'down' : 'up';
			}
			player.movement[dir] = true;
			// Plus réactif en attaque, plus posé en recherche
			b.moveUntil = Date.now() + (target ? 250 + Math.floor(Math.random()*450) : 400 + Math.floor(Math.random()*900));
			b.stuck = false;
		}

		// Rechargement puis tir — uniquement à condition de vraiment voir la cible
		if (player.ammo <= 0) { player.ammo = maxAM; b.cooldown = 60; }
		if (target && b.cooldown <= 0) {
			const px = player.x + 10;
			const py = player.y + 10;
			const delX = target.x + 10 - px;
			const delY = target.y + 10 - py;
			const dist = Math.hypot(delX, delY);
			if (dist > 0 && botHasCleanShot(px, py, target.x + 10, target.y + 10, playerId, player.team)) {
				const ratio = mapDiag / dist;
				fireBullet(px, py, px + ratio * delX, py + ratio * delY, playerId);
				player.ammo -= 1;
				b.cooldown = 25 + Math.floor(Math.random() * 55); // ~0,4 à 1,3 s : agressif
			}
			else {
				b.cooldown = 15; // réévaluer la ligne de vue très rapidement
			}
		}
		else b.cooldown--;
	}
}
