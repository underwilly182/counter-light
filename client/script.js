// client/script.js
const socket = io();

// Récupérez le canva et son contexte
const loginForm = document.getElementById('login-form');
const startGameBtn = document.getElementById('start-game-btn');
const sendInfoBtn = document.getElementById('send-info-btn');
const teamInfoDiv = document.getElementById('team-info');
const teamInfoListA = document.getElementById('team-info-listA');
const teamInfoListB = document.getElementById('team-info-listB');
const gameContainer = document.getElementById('game');

const canvas = document.getElementById('gameCanvas');
const canvasS = document.getElementById('shadowCanvas');
const canvasShoot = document.getElementById('shootCanvas');
const canvasPlayer = document.getElementById('playerCanvas');
const ctx = canvas.getContext('2d');
const ctxS = canvasS.getContext('2d');
const ctxShoot = canvasShoot.getContext('2d');
const ctxPlayer = canvasPlayer.getContext('2d');
canvas.width = 800;
canvasS.width = 800;
canvasShoot.width = 800;
canvasPlayer.width = 800;
canvas.height = 400;
canvasS.height = 400;
canvasShoot.height = 400;
canvasPlayer.height = 400;
let pid = "";

// Mode démo (/demo.html) : spectateur de bots
const IS_DEMO = document.body.hasAttribute('data-demo');
let spectateId = null;      // joueur suivi par la caméra
let spectateSwitch = false; // demande de changement de cible

const debug = false;

let gameInProgress = false;
let living = false;
let reloading = false;
let ammo = 0;

// ---- Préchargement des sons (Web Audio) ----
// Lancé dès l'arrivée dans le lobby : les fichiers sont téléchargés ET décodés
// en mémoire pendant que le joueur remplit le formulaire, ce qui supprime tout
// lag à la première lecture en jeu (l'ancien new Audio() + cloneNode() redécodait
// le son à chaque premier play()).
let audioCtx = null;
const soundBuffers = {};

// Retourne (en la créant au premier appel) l'AudioContext global du navigateur.
// Param : aucun — Retour : {AudioContext|null} null si le navigateur est incompatible.
function getAudioCtx() {
	if (!audioCtx) {
		const Ctx = window.AudioContext || window.webkitAudioContext;
		if (Ctx) audioCtx = new Ctx();
	}
	return audioCtx;
}

// Télécharge un son et le décode en mémoire pour une lecture instantanée.
// Params : name {string} clé interne du son ; url {string} chemin du fichier.
// Retour : {Promise<void>} (échec silencieux, avec warning console).
async function preloadSound(name, url) {
	const ctx = getAudioCtx();
	if (!ctx) return;
	try {
		const resp = await fetch(url);
		const buf = await resp.arrayBuffer();
		soundBuffers[name] = await ctx.decodeAudioData(buf);
		if (debug) console.log("Son préchargé : " + name);
	} catch (e) {
		console.warn("Préchargement impossible pour " + name, e);
	}
}

// Rejoue un son déjà décodé (instantané). Reprise du contexte si le
// navigateur l'avait suspendu (politique de lecture automatique).
// Params : name {string} clé du son (définie via preloadSound) ;
// volume {number} gain optionnel, défaut 1.
// Retour : aucun.
function playSound(name, volume) {
	const ctx = getAudioCtx();
	if (!ctx || !soundBuffers[name]) return;
	if (ctx.state === 'suspended') ctx.resume();
	const src = ctx.createBufferSource();
	src.buffer = soundBuffers[name];
	const gain = ctx.createGain();
	gain.gain.value = (typeof volume === 'number') ? volume : 1;
	src.connect(gain);
	gain.connect(ctx.destination);
	src.start();
}

// Préchargement en arrière-plan pendant le lobby
preloadSound('bang', './snd/gunshot-sound-effect.mp3');
preloadSound('gun_reload', './snd/guncocking.mp3');
preloadSound('clic', './snd/gunclick.mp3');
	
	let imgImp = new Image();
	imgImp.src = './img/impact.png';
	let imgP2 = new Image();
	imgP2.src = './img/cop2.png';
		let imgP2Hurt = new Image();
		imgP2Hurt.src = './img/cop2-hurt.png';
		let imgP2Dead = new Image();
		imgP2Dead.src = './img/cop2-dead.png';
	let imgP3 = new Image();
	imgP3.src = './img/cop3.png';
		let imgP3Hurt = new Image();
		imgP3Hurt.src = './img/cop3-hurt.png';
		let imgP3Dead = new Image();
		imgP3Dead.src = './img/cop3-dead.png';

// Carte 4x (1600x800) : le client n'affiche qu'une fenêtre 800x400 (caméra)
let mapW = 800, mapH = 400;
let camX = 0, camY = 0;
let obstaclesC = {};
// Le décor entier est dessiné une fois dans un canvas hors-écran
const obstBuffer = document.createElement('canvas');
const ctxB = obstBuffer.getContext('2d');

socket.on('mapSize', ({ width, height }) => {
	mapW = width;
	mapH = height;
	obstBuffer.width = mapW;
	obstBuffer.height = mapH;
});

if (IS_DEMO) {
	// Lancer la démo dès la connexion au serveur
	if (socket.connected) socket.emit('startDemo');
	else socket.on('connect', () => socket.emit('startDemo'));
	// Caméra : changer de joueur suivi toutes les 4 secondes
	setInterval(() => { spectateSwitch = true; }, 4000);
}

loginForm.addEventListener('submit', (event) => {
	event.preventDefault();
});

sendInfoBtn.addEventListener('click', () => {
  const username = document.getElementById('username').value;
  const team = document.querySelector('input[name="team"]:checked').value;
  socket.emit('playerJoin', { username, team });
});

document.addEventListener('mousedown', () => {
	// Envoyer un message au serveur lorsque le joueur tire
	if (event.buttons == 1 && ammo > 0 && !reloading && gameInProgress && living) {
		// cellElement = document.getElementById(pid);
		// cellElement.classList.add('shooting');
		// setTimeout(function() {  cellElement.classList.remove('shooting'); }, 100);
		const mouseX = event.clientX - canvas.offsetLeft + camX;
		const mouseY = event.clientY - canvas.offsetTop + camY;
		// Réduire le nombre de munitions
		ammo--;
		ammoUpdate();
		if (debug) console.log("Ammo -1");
		// déplacer ça dans socket.on'shotHeard'
		playSound('bang');
		//console.log("PAN");
		//For debug only
		/* ctx.moveTo(pidX+10, pidY+10);
		ctx.lineTo(mouseX, mouseY);
		ctx.stroke(); */
		//fin debug
		socket.emit('shoot', { mouseX, mouseY});
		if (ammo == 0 && gameInProgress && living) {
			document.getElementById("reload").style.display = "block";
		}
	}
	else if(ammo == 0 && gameInProgress && living) {
		playSound('clic');
		// document.getElementById("reload").style.display = "block";
	}
});

document.addEventListener('keyup', (event) => {
	if (gameInProgress && living) {
		switch (event.key) {
			case 'z':
				stopMovement('up');
				break;
			case 's':
				stopMovement('down');
				break;
			case 'q':
				stopMovement('left');
				break;
			case 'd':
				stopMovement('right');
				break;
		}
	}
});
		
document.addEventListener('keydown', (event) => {
	if (gameInProgress && living) {
		switch (event.key) {
			case 'z':
			  startMovement('up');
			  break;
			case 's':
			  startMovement('down');
			  break;
			case 'q':
			  startMovement('left');
			  break;
			case 'd':
			  startMovement('right');
			  break;
			case 'r':
				//console.log("Reloading");
				if (!reloading && ammo < 6) {
					document.getElementById("reload").style.display = "none";
					reloading = true;
					playSound('gun_reload');
					setTimeout(() => {
						ammo = 6;
						reloading = false;
						ammoUpdate();
						//console.log("Reloaded");
					}, 1280); // 2 secondes de rechargement
				}
			  break;
		}
	}
});

document.addEventListener('mousemove', (event) => {
	if (gameInProgress && living) {
		// Envoyer un message au serveur avec la direction de rotation
		// console.log('Page X :'+event.pageX);
		// console.log('Game X :'+gameCanvas.offsetLeft);
		// console.log('MX :'+mx);
		const mx = event.pageX - canvas.offsetLeft + camX;
		// console.log('Page Y :'+event.pageY);
		// console.log('Game Y :'+gameCanvas.offsetTop);
		// console.log('MY :'+my);
		const my = event.pageY - canvas.offsetTop + camY;
		//console.log(mx + " " + my);
		socket.emit('rotate', mx, my); // +mouseposition
	}
});

socket.on('updateTeams', (teams) => {
	teamInfoListA.innerHTML = '';
	teamInfoListB.innerHTML = '';
	//teamInfoDiv.innerHTML = 'Equipes choisies par les autres joueurs :<br>';
	teams.forEach(({ username, team }) => {
		// SÉCURITÉ : textContent empêche toute injection HTML via le pseudo (anti-XSS)
		const li = document.createElement('li');
		li.className = team;
		li.textContent = `${username} - ${team}`;
		if (team == "A")
			teamInfoListA.appendChild(li);
		else
			teamInfoListB.appendChild(li);
	});
});

socket.on('enableStartButton', () => {
  startGameBtn.disabled = false;
  // L'host (lanceur) peut activer les chans vocaux pour la partie
  const voiceOption = document.getElementById('voice-chat-option');
  if (voiceOption) voiceOption.style.display = 'block';
});

socket.on('connectionError', (errorMessage) => {
    // Afficher le message d'erreur à l'utilisateur
    // alert(errorMessage);
    // Rediriger ou effectuer une action appropriée, par exemple revenir à l'écran de connexion
});

startGameBtn.addEventListener('click', () => {
	if (debug) console.log("Let's go!");
	// L'host transmet son choix de chans vocaux au lancement
	const voiceSelect = document.getElementById('voice-chat-select');
	socket.emit('startGame', { voiceChat: !!(voiceSelect && voiceSelect.value === 'yes') });
});

socket.on('gameStarted', (players) => {
	if (players[socket.id]) {
		living = true;
		gameInProgress = true;
		ammo = players[socket.id].ammo;
		ammoUpdate();
		document.getElementById('lifepoints').max = players[socket.id].lifepoints;
		document.getElementById('lifepoints').value = players[socket.id].lifepoints;
		// Masquer l'écran de connexion et afficher le contenu du jeu
		document.getElementById('login-screen').style.display = 'none';
		gameContainer.style.display = 'grid';		
	}
	if (IS_DEMO) {
		// Spectateur : pas de joueur réel, on regarde les bots s'affronter
		gameInProgress = true;
		document.getElementById('login-screen').style.display = 'none';
		document.getElementById('scores').style.display = 'none';
		gameContainer.style.display = 'grid';
	}
	// V2 du mouvement côté serveur
	// setInterval(updateFreq, 1000/60);
});

socket.on('gameEnded', ({players, launcherId, winningTeam}) => {
	// clearInterval(refreshIntervalId);
	gameInProgress = false;
	if (players[socket.id] || IS_DEMO) showScores(players, winningTeam);
	if (pid == launcherId) printRelaunch();
	document.getElementById("reload").style.display = "none";
});

socket.on('relaunchForAll', () => {
	if (debug) console.log("Relaunch for all!");
	document.getElementById("scores").style.display = "none";
	gameContainer.style.display = 'none';
	document.getElementById('login-screen').style.display = "block";
});

// Gestion de l'événement de déconnexion du serveur
socket.on('disconnect', () => {
    // Code à exécuter lorsque la connexion au serveur est perdue
    //alert('La connexion au serveur a été perdue. Veuillez réessayer plus tard.');
    // Autres actions que vous souhaitez effectuer en cas de déconnexion
	gameInProgress = false;
	location.reload();
});

/* socket.on('PV', ({lifepoints, ammoR}) => {
	if (debug) console.log("ammoR "+ammoR);
	if (debug) console.log("lifepoints "+lifepoints);
	ammo = ammoR;
	const lifeContainer = document.getElementById('lifepoints');
	lifeContainer.value = lifepoints;
	lifeContainer.max = lifepoints;
	const ammoContainer = document.getElementById('ammo');
	ammoContainer.value = ammo;
	ammoContainer.max = ammo;
}); */

// Génère une tuile de sol béton en pixel-art (gris clair, bruit par pixel,
// joints de dallage, fissures et taches), dessinée sur un canvas hors-écran.
// La graine du hasard est fixe : la texture est identique pour tous les joueurs.
// Param : size {number} côté de la tuile en pixels (défaut 64).
// Retour : {HTMLCanvasElement} tuile prête pour ctx.createPattern(tile, "repeat").
function buildConcreteTile(size = 64) {
	const tile = document.createElement('canvas');
	tile.width = size;
	tile.height = size;
	const tctx = tile.getContext('2d');
	// PRNG déterministe
	let seed = 0xC0FFEE;
	const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
	tctx.fillStyle = '#8a8f94';
	tctx.fillRect(0, 0, size, size);
	// Bruit par pixel (aspect béton)
	const imgData = tctx.getImageData(0, 0, size, size);
	const d = imgData.data;
	for (let i = 0; i < d.length; i += 4) {
		const n = (rnd() - 0.5) * 22;
		d[i] += n; d[i + 1] += n; d[i + 2] += n;
	}
	tctx.putImageData(imgData, 0, 0);
	// Joints du dallage sur les bords haut/gauche (tuilable par construction)
	tctx.fillStyle = '#6f7478';
	tctx.fillRect(0, 0, size, 2);
	tctx.fillRect(0, 0, 2, size);
	tctx.fillStyle = 'rgba(255,255,255,0.08)';
	tctx.fillRect(0, 2, size, 1);
	tctx.fillRect(2, 0, 1, size);
	// Fissures : petites marches aléatoires
	tctx.strokeStyle = '#6b7075';
	tctx.lineWidth = 1;
	for (let c = 0; c < 3; c++) {
		let x = 4 + rnd() * (size - 8);
		let y = 4 + rnd() * (size - 8);
		tctx.beginPath();
		tctx.moveTo(x, y);
		for (let s = 0; s < 6; s++) {
			x += (rnd() - 0.5) * 10;
			y += (rnd() - 0.5) * 10;
			tctx.lineTo(x, y);
		}
		tctx.stroke();
	}
	// Taches sombres (usure)
	tctx.fillStyle = 'rgba(60,64,68,0.18)';
	for (let s = 0; s < 5; s++) {
		tctx.beginPath();
		tctx.arc(rnd() * size, rnd() * size, 2 + rnd() * 5, 0, Math.PI * 2);
		tctx.fill();
	}
	return tile;
}
// Tuile de sol réutilisable pour tous les dessins du décor
const concreteTile = buildConcreteTile(64);

socket.on('obstacles', (obstacles) => {
	// console.log("obstacles received");
	obstaclesC = obstacles;
	pid = socket.id;
	//console.log("Pid "+pid);
	const img = new Image();
	img.src = "./img/brick-wall.jpg";
	img.onload = () => {
		ctxB.clearRect(0, 0, obstBuffer.width, obstBuffer.height);
		// Sol : dallage béton sur toute la carte, derrière les obstacles
		ctxB.fillStyle = ctxB.createPattern(concreteTile, "repeat");
		ctxB.fillRect(0, 0, obstBuffer.width, obstBuffer.height);
		const pattern = ctxB.createPattern(img, "repeat");
		ctxB.fillStyle = pattern;
		for (const obstacleId in obstacles) {
			const obst = obstacles[obstacleId];
			ctxB.fillRect(obst.x, obst.y, obst.w, obst.h);
		}
	};
});

socket.on('drawShoot', ({px, py, hitX, hitY}) => {
	if (debug) console.log("Have to drawShoot");
	//ctxShoot.clearRect(0, 0, canvasShoot.width, canvasShoot.height);
	ctxShoot.save();
	ctxShoot.translate(-camX, -camY);
	ctxShoot.beginPath();
	ctxShoot.moveTo(px, py);
	ctxShoot.lineTo(hitX, hitY);
	ctxShoot.strokeStyle = "orange";
	ctxShoot.shadowColor = "red";
	ctxShoot.shadowBlur = 10;
	ctxShoot.stroke();
	ctxShoot.restore();
});

setInterval(clearShoot, 1000/10); // 10 fps pour le refresh du canvas des tirs ;)

// Efface le canvas des lignes de tir (trajectoires).
// Param : aucun — Retour : aucun.
function clearShoot() {
	ctxShoot.clearRect(0, 0, canvasShoot.width, canvasShoot.height);
};


socket.on('shot', (playerId) => {
  if (debug) console.log(`Joueur ${playerId} a tiré !`);
  // Ajouter ici le code pour gérer l'affichage des tirs dans le jeu
});

socket.on('updateHealth', ({playerId, health}) => {
	//console.log("Joueur "+playerId+" a maintenant "+health+" points de vie.");
	if (gameInProgress && living) {
		if (playerId == pid) {
			// console.log(":( Been shot");
			const lifeContainer = document.getElementById('lifepoints');
			lifeContainer.value = health;
			if (health == 0) {
				living = false;
				if (debug) console.log("Aouch je suis mort");
			}
		}
		if (health > 0) {
			cellElement = document.getElementById(playerId);
			cellElement.classList.add('hurt');
			setTimeout(function() {  cellElement.classList.remove('hurt'); }, 500);
		}
	}
});

socket.on('gameOver', (remainingTeams) => {
  if (debug) console.log('Fin de la partie ! Résultats :', remainingTeams);
  // Ajouter ici le code pour afficher les résultats de la partie et proposer de rejouer
});

// let movement = { up: false, down: false, left: false, right: false };

// Prévient le serveur qu'une direction de mouvement est activée.
// Param : direction {string} 'up' | 'down' | 'left' | 'right'.
// Retour : aucun (émet 'start-move').
function startMovement(direction) {
	// movement[direction] = true;
	// V2 toggle
	socket.emit('start-move', direction);
}

// Prévient le serveur qu'une direction de mouvement est relâchée.
// Param : direction {string} 'up' | 'down' | 'left' | 'right'.
// Retour : aucun (émet 'stop-move').
function stopMovement(direction) {
	// movement[direction] = false;
	// V2 toggle
	socket.emit('stop-move', direction);
}

socket.on('updateAnglesAndPositions', (players) => {
	ctxPlayer.setTransform(1, 0, 0, 1, 0, 0);
	ctxPlayer.clearRect(0, 0, canvasPlayer.width, canvasPlayer.height);
	// Cible de la caméra : mon joueur, ou (mode démo) un bot suivi
	let camId = null;
	if (IS_DEMO) {
		const aliveIds = Object.keys(players).filter(id => players[id].alive);
		if (aliveIds.length > 0) {
			if (spectateSwitch || !spectateId || !players[spectateId] || !players[spectateId].alive) {
				const idx = aliveIds.indexOf(spectateId);
				spectateId = aliveIds[(idx + 1) % aliveIds.length];
				spectateSwitch = false;
			}
			camId = spectateId;
		}
	}
	else if (gameInProgress && living && players[pid]) {
		camId = pid;
	}
	if (camId) {
		// Caméra centrée sur la cible, bornée aux limites de la carte
		camX = Math.max(0, Math.min(players[camId].x + 10 - canvas.width / 2, mapW - canvas.width));
		camY = Math.max(0, Math.min(players[camId].y + 10 - canvas.height / 2, mapH - canvas.height));

		// Décor : fenêtre caméra dans le monde
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		ctx.drawImage(obstBuffer, -camX, -camY);

		// Joueurs (coordonnées monde + translation caméra)
		ctxPlayer.translate(-camX, -camY);
		for (const playerId in players) {
			if (players[playerId].alive) {
				ctxPlayer.save();
				ctxPlayer.translate(players[playerId].x+10,players[playerId].y+10);
				ctxPlayer.rotate(players[playerId].angle);
				if (players[playerId].team == "A") {
					if (players[playerId].framesHurt > 0) ctxPlayer.drawImage(imgP2Hurt, -10, -10, 20, 20);
					else ctxPlayer.drawImage(imgP2, -10, -10, 20, 20);
				}
				else {
					if (players[playerId].framesHurt > 0) ctxPlayer.drawImage(imgP3Hurt, -10, -10, 20, 20);
					else ctxPlayer.drawImage(imgP3, -10, -10, 20, 20);
				}
				ctxPlayer.restore();
				// Pseudo au-dessus du joueur (droit, non affecté par la rotation)
				ctxPlayer.save();
				ctxPlayer.translate(players[playerId].x+10, players[playerId].y+10);
				ctxPlayer.font = '10px Courier';
				ctxPlayer.textAlign = 'center';
				ctxPlayer.lineWidth = 3;
				ctxPlayer.strokeStyle = 'rgba(255,255,255,0.7)';
				ctxPlayer.strokeText(players[playerId].username, 0, -13);
				ctxPlayer.fillStyle = (players[playerId].team == "A") ? 'darkmagenta' : 'darkorange';
				ctxPlayer.fillText(players[playerId].username, 0, -13);
				ctxPlayer.restore();
				if (playerId == camId) {
					refreshMaskView(players[playerId].x, players[playerId].y);
				}
			}
			// Dessin des joueurs morts
			else {
				ctxPlayer.save();
				ctxPlayer.translate(players[playerId].x+10,players[playerId].y+10);
				ctxPlayer.rotate(players[playerId].angle);
				if (players[playerId].team == "A") {
					ctxPlayer.drawImage(imgP2Dead, -10, -10, 20, 20);
				}
				else {
					ctxPlayer.drawImage(imgP3Dead, -10, -10, 20, 20);
				}
				ctxPlayer.restore();
			}
		}

		// (mode démo) HUD lié au joueur suivi
		if (IS_DEMO) {
			const lc = document.getElementById('lifepoints');
			lc.max = players[camId].lifepoints;
			lc.value = players[camId].lifepoints;
			document.getElementById('ammo').value = players[camId].ammo;
		}
	}
});

// Redessine le masque d'ombres : obscurcit tout le viewport sauf les zones
// visibles depuis le joueur (polygones dégagés construits autour de chaque
// obstacle). Utilisé uniquement pour le joueur suivi par la caméra.
// Params : px,py {number} coin haut-gauche du joueur (coordonnées monde).
// Retour : aucun (dessine sur canvasS).
function refreshMaskView(px, py) {
	// console.log("refresh mask");
	// Pour chaque obstacle
	px = px + 10;
	py = py + 10;
	// Effacement en coordonnées écran, puis translation caméra pour dessiner en coordonnées monde
	ctxS.setTransform(1, 0, 0, 1, 0, 0);
	ctxS.clearRect(0, 0, canvasS.width, canvasS.height);
	ctxS.translate(-camX, -camY);
	const ch = canvasS.height;
	const cw = canvasS.width;
	for (const obstacleId in obstaclesC) {
		const obst = obstaclesC[obstacleId];
		const m = (obst.y-py) / (obst.x-px);
		const m2 = (obst.y+obst.h-py) / (obst.x+obst.w-px);
		const m3 = (obst.y-py) / (obst.x+obst.w-px);
		const m4 = (obst.y+obst.h-py) / (obst.x-px);
		// V3 !!
		ctxS.beginPath();
		// Si tout l'obstacle est au-dessus, et à droite, on projete tout sur le haut du viewport => m m2
		if (obst.y < py && obst.y+obst.h < py && px < obst.x) {
			ctxS.moveTo(obst.x, obst.y); //m
			ctxS.lineTo(obst.x+(camY-obst.y)/m, camY);
			ctxS.lineTo(obst.x+obst.w+(camY-obst.y-obst.h)/m2, camY);
			ctxS.lineTo(obst.x+obst.w, obst.y+obst.h); //m2
			ctxS.lineTo(obst.x+obst.w, obst.y);
		}
		// Si tout l'obstacle est au-dessus, et à gauche, on projete tout sur le haut du viewport => m3 m4
		else if (obst.y < py && obst.y+obst.h < py && px > obst.x+obst.w) {
			ctxS.moveTo(obst.x+obst.w, obst.y); //m3
			ctxS.lineTo(obst.x+obst.w+(camY-obst.y)/m3, camY);
			ctxS.lineTo(obst.x+(camY-obst.y-obst.h)/m4, camY);
			ctxS.lineTo(obst.x, obst.y+obst.h); //m4
			ctxS.lineTo(obst.x, obst.y);
		}
		//Si l'obstacle est au dessus mais entre les 2 => m4 m2
		else if (obst.y < py && obst.y+obst.h < py) {
			ctxS.moveTo(obst.x, obst.y+obst.h); //m4
			ctxS.lineTo(obst.x+(camY-obst.y-obst.h)/m4, camY);
			ctxS.lineTo(obst.x+obst.w+(camY-obst.y-obst.h)/m2, camY);
			ctxS.lineTo(obst.x+obst.w, obst.y+obst.h); //m2
			ctxS.lineTo(obst.x+obst.w, obst.y); //m3
			ctxS.lineTo(obst.x, obst.y); //m
		}
		// Si tout l'obstacle est en-dessous, et à gauche, on projete tout sur le bas du viewport =>m m2
		else if (obst.y > py && obst.y+obst.h > py && px > obst.x+obst.w) {
			ctxS.moveTo(obst.x, obst.y); //m
			ctxS.lineTo(obst.x+(camY+ch-obst.y)/m, camY+ch);
			ctxS.lineTo(obst.x+obst.w+(camY+ch-obst.y-obst.h)/m2, camY+ch);
			ctxS.lineTo(obst.x+obst.w, obst.y+obst.h); //m2
			ctxS.lineTo(obst.x, obst.y+obst.h); //m4
		}
		// Si tout l'obstacle est en-dessous, et à droite, on projete tout sur le bas du viewport =>m3 m4
		else if (obst.y > py && obst.y+obst.h > py && px < obst.x) {
			ctxS.moveTo(obst.x+obst.w, obst.y); //m3
			ctxS.lineTo(obst.x+obst.w+(camY+ch-obst.y)/m3, camY+ch);
			ctxS.lineTo(obst.x+(camY+ch-obst.y-obst.h)/m4, camY+ch);
			ctxS.lineTo(obst.x, obst.y+obst.h); //m4
			ctxS.lineTo(obst.x+obst.w, obst.y+obst.h); //m2
		}
		//Si l'obstacle est en dessous mais entre les 2 => m m3
		else if (obst.y > py && obst.y+obst.h > py) {
			ctxS.moveTo(obst.x, obst.y); //m
			ctxS.lineTo(obst.x+(camY+ch-obst.y)/m, camY+ch);
			ctxS.lineTo(obst.x+obst.w+(camY+ch-obst.y)/m3, camY+ch);
			ctxS.lineTo(obst.x+obst.w, obst.y); //m3
			ctxS.lineTo(obst.x+obst.w, obst.y+obst.h); //m2
			ctxS.lineTo(obst.x, obst.y+obst.h); //m4
		}
		//Si l'obstacle est à ma gauche à mihauteur => projection sur le bord gauche du viewport
		else if (obst.x+obst.w < px) {
			ctxS.moveTo(obst.x+obst.w, obst.y); //m3
			ctxS.lineTo(camX, m3*(camX-obst.x-obst.w)+obst.y);
			ctxS.lineTo(camX, m2*(camX-obst.x-obst.w)+obst.y+obst.h);
			ctxS.lineTo(obst.x+obst.w, obst.y+obst.h); //m2
			ctxS.lineTo(obst.x, obst.y+obst.h); //m4
			ctxS.lineTo(obst.x, obst.y); //m	
		}
		//Si l'obstacle est à ma droite à mihauteur => projection sur le bord droit du viewport
		else {
			ctxS.moveTo(obst.x, obst.y); //m
			ctxS.lineTo(camX+cw, m*(camX+cw-obst.x)+obst.y);
			ctxS.lineTo(camX+cw, m4*(camX+cw-obst.x)+obst.y+obst.h);
			ctxS.lineTo(obst.x, obst.y+obst.h); //m4
			ctxS.lineTo(obst.x+obst.w, obst.y+obst.h); //m2
			ctxS.lineTo(obst.x+obst.w, obst.y); //m3
			ctxS.closePath();
		}
		ctxS.closePath();
		ctxS.fill();
	}
}

socket.on('obstTouched', ({x, y}) => {
	// console.log("obstTouched " +x+ " " +y);
	ctxShoot.save();
	ctxShoot.translate(-camX, -camY);
	ctxShoot.drawImage(imgImp, x-6, y-6, 12, 12);
	if (debug) console.log("Draw impact");
	ctxShoot.restore();
	// const impactContainer = document.getElementById('impactContainer');
	// const cellElement = document.createElement('div');
	// cellElement.classList.add('impact');
	// cellElement.style.top = y-6 + 'px';
	// cellElement.style.left = x-6 + 'px';
	// impactContainer.appendChild(cellElement);
	// setTimeout(() => {  impactContainer.removeChild(cellElement); }, 250);
});

function ammoUpdate() {
	const ammoContainer = document.getElementById('ammo');
	ammoContainer.value = ammo;
}

function showScores(players, winningTeam) {
	const divScores = document.getElementById("scores");
	divScores.style.display = 'block';
	divScores.innerHTML = "<h2>Scores</h2><h3></h3><table id='scores-table'></table>";
	const teamWon = divScores.getElementsByTagName("h3")[0];
	teamWon.innerHTML = "Team "+winningTeam+" won the game !";
	teamWon.classList.toggle("Bwon", (winningTeam == "B"));
	const tabScores = document.getElementById("scores-table");
	tabScores.innerHTML = "<thead><tr><th>Name</th><th>Hit</th><th>Kill</th><th>Friendly fire</th><th>Friendly kill</th><th>TOTAL SCORE</th></tr></thead><tbody></tbody>"; // Ne suffit pas, il faut reconstruire tout le divScores
	for (const playerId in players) {
		let row = tabScores.insertRow();
		if (pid == playerId) row.style.fontWeight = "bold";
		// SÉCURITÉ : textContent empêche toute injection HTML via le pseudo (anti-XSS)
		row.insertCell().textContent = players[playerId].username;
		row.insertCell().textContent = players[playerId].scores.hit;
		row.insertCell().textContent = players[playerId].scores.kill;
		row.insertCell().textContent = players[playerId].scores.ff;
		row.insertCell().textContent = players[playerId].scores.fk;
		row.insertCell().textContent = players[playerId].scores.kill*5 + players[playerId].scores.hit - players[playerId].scores.ff*2 - players[playerId].scores.fk*10;
	}
}

function printRelaunch() {
	const scoresContainer = document.getElementById("scores");
	const buttonElement = document.createElement('button');
	buttonElement.id = "relaunch-btn";
	buttonElement.innerHTML = "Relancer une partie";
	scoresContainer.appendChild(buttonElement);
	buttonElement.addEventListener('click', (event) => {
		//alert("C'est reparti !");
		socket.emit("relaunchGame");
	});
}
