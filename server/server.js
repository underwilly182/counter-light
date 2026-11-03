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
function isFiniteNumber(v) {
	return typeof v === 'number' && Number.isFinite(v);
}
// =========================================================

let nbPlayers = 0; // Nb de joueurs VIVANTS
let gameInProgress = false;
let launcherId = 0;

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
		delete waiters[socket.id];
		delete players[socket.id];
		io.emit('updateTeams', Object.values(waiters));
		if (gameInProgress) {
			nbPlayers -= 1;
			io.emit('players', players);
		// io.emit('updateTeams', Object.values(waiters));
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
		if (Object.keys(waiters).length === 1 && gameInProgress == false) {
			socket.emit('enableStartButton');
			launcherId = socket.id;
		}
	});

	socket.on('startGame', () => {
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
		// D'autres actions pour démarrer le jeu peuvent être ajoutées ici
		
	});
	
	socket.on("urgentObstacles", () => {
		socket.emit("mapSize", { width: map.width, height: map.height });
		socket.emit("obstacles", obstacles);
	});
	
	socket.on("relaunchGame", () => {
		io.emit("relaunchForAll");
	});
	  		
});

server.listen(PORT, () => {
	console.log('Serveur en écoute sur le port *:3000');
});

// LINE/RECTANGLE
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

// LINE/LINE
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

function gameUpdate() {
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

function updatePlayerPosition(playerId) {
	const player = players[playerId];
	adaptMoveToObstacles(playerId);
	if (player.movement.up) players[playerId].y -= 1;
	if (player.movement.down) players[playerId].y += 1;
	if (player.movement.left) players[playerId].x -= 1;
	if (player.movement.right) players[playerId].x += 1;
}
	
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

function killPlayer(playerId) {
	if (debug) console.log("Killing "+playerId);
	players[playerId].alive = false;
	nbPlayers -= 1;
	//io.emit('players', players);
	// io.emit('updateTeams', Object.values(waiters));
	if (debug) console.log("Nbplayers alive "+nbPlayers);
	if (nbPlayers <= 1) {
		if (debug) console.log("LastKill -> Endgame");
	}
	checkRemainingTeams();
}

function endGame(winningTeam) {
	gameInProgress = false;
	if (debug) console.log("Game ended");
	io.emit('gameEnded', {players, launcherId, winningTeam});
	// Putting back players in waiters list
}

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
