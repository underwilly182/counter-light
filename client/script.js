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

const debug = false;

let gameInProgress = false;
let living = false;
let reloading = false;
let ammo = 0;

	let bang = new Audio('./snd/gunshot-sound-effect.mp3');
	bang.load();
	let gun_reload = new Audio('./snd/guncocking.mp3');
	gun_reload.load();
	let clic = new Audio('./snd/gunclick.mp3');
	clic.load();
	
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

let obstaclesC = {};

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
		const mouseX = event.clientX - canvas.offsetLeft;
		const mouseY = event.clientY - canvas.offsetTop;
		// Réduire le nombre de munitions
		ammo--;
		ammoUpdate();
		if (debug) console.log("Ammo -1");
		// déplacer ça dans socket.on'shotHeard'
		// bang.load();
		bang.cloneNode(true).play();
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
		// clic.load();
		clic.cloneNode(true).play();
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
					// gun_reload.load();
					gun_reload.cloneNode(true).play();
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
		const mx = event.pageX - canvas.offsetLeft;
		// console.log('Page Y :'+event.pageY);
		// console.log('Game Y :'+gameCanvas.offsetTop);
		// console.log('MY :'+my);
		const my = event.pageY - canvas.offsetTop;
		//console.log(mx + " " + my);
		socket.emit('rotate', mx, my); // +mouseposition
	}
});

socket.on('updateTeams', (teams) => {
	teamInfoListA.innerHTML = '';
	teamInfoListB.innerHTML = '';
	//teamInfoDiv.innerHTML = 'Equipes choisies par les autres joueurs :<br>';
	teams.forEach(({ username, team }) => {
		if (team == "A")
			teamInfoListA.innerHTML += `<li class="${team}">${username} - ${team}</li>`;
		else
			teamInfoListB.innerHTML += `<li class="${team}">${username} - ${team}</li>`;
	});
});

socket.on('enableStartButton', () => {
  startGameBtn.disabled = false;
});

socket.on('connectionError', (errorMessage) => {
    // Afficher le message d'erreur à l'utilisateur
    // alert(errorMessage);
    // Rediriger ou effectuer une action appropriée, par exemple revenir à l'écran de connexion
});

startGameBtn.addEventListener('click', () => {
	if (debug) console.log("Let's go!");
	socket.emit('startGame');
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
	// V2 du mouvement côté serveur
	// setInterval(updateFreq, 1000/60);
});

socket.on('gameEnded', ({players, launcherId, winningTeam}) => {
	// clearInterval(refreshIntervalId);
	gameInProgress = false;
	if (players[socket.id]) showScores(players, winningTeam);
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

socket.on('obstacles', (obstacles) => {
	// console.log("obstacles received");
	obstaclesC = obstacles;
	pid = socket.id;
	//console.log("Pid "+pid);
	// const mapContainer = document.getElementById('map');
	const img = new Image();
	img.src = "./img/brick-wall.jpg";
	//ctx.fillStyle="red";
	img.onload = () => {
	for (const obstacleId in obstacles) {
		const obst = obstacles[obstacleId];
		const pattern = ctx.createPattern(img, "repeat");
		ctx.fillStyle = pattern;
		ctx.fillRect(obst.x, obst.y, obst.w, obst.h);
	}
	}
});

socket.on('drawShoot', ({px, py, hitX, hitY}) => {
	if (debug) console.log("Have to drawShoot");
	//ctxShoot.clearRect(0, 0, canvasShoot.width, canvasShoot.height);
	ctxShoot.beginPath();
	ctxShoot.moveTo(px, py);
	ctxShoot.lineTo(hitX, hitY);
	ctxShoot.strokeStyle = "orange";
	ctxShoot.shadowColor = "red";
	ctxShoot.shadowBlur = 10;
	ctxShoot.stroke();
});

setInterval(clearShoot, 1000/10); // 10 fps pour le refresh du canvas des tirs ;)

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

// Fonction pour activer les mouvements
function startMovement(direction) {
	// movement[direction] = true;
	// V2 toggle
	socket.emit('start-move', direction);
}

// Fonction pour désactiver les mouvements
function stopMovement(direction) {
	// movement[direction] = false;
	// V2 toggle
	socket.emit('stop-move', direction);
}

socket.on('updateAnglesAndPositions', (players) => {
	ctxPlayer.clearRect(0, 0, canvasPlayer.width, canvasPlayer.height);
	// ctxPlayer.beginPath();
	if (gameInProgress && living) {
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
				// const player = document.getElementById(playerId);
				// player.style.left = players[playerId].x + 'px';
				// player.style.top = players[playerId].y + 'px';
				if (playerId == pid) { 
					/* pidX = position.x; pidY = position.y; */ 
					refreshMaskView(players[playerId].x, players[playerId].y); 
				}
				// const playerS = player.lastChild;
				// playerS.style.transform = `rotate(${players[playerId].angle}rad)`;
			}
			// Rajouter le dessin des joueurs morts
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
	}
	// ctxPlayer.clearRect(0, 0, ctxPlayer.width, ctxPlayer.height);
});

function refreshMaskView(px, py) {
	// console.log("refresh mask");
	// Pour chaque obstacle
	px = px + 10;
	py = py + 10;
	ctxS.clearRect(0, 0, canvasS.width, canvasS.height);
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
		// Si tout l'obstacle est au-dessus, et à droite, on projete tout sur y=0 => m m2
		if (obst.y < py && obst.y+obst.h < py && px < obst.x) {
			ctxS.moveTo(obst.x, obst.y); //m
			ctxS.lineTo(obst.x+(0-obst.y)/m, 0);
			ctxS.lineTo(obst.x+obst.w+(0-obst.y-obst.h)/m2, 0);
			ctxS.lineTo(obst.x+obst.w, obst.y+obst.h); //m2
			ctxS.lineTo(obst.x+obst.w, obst.y);
		}
		// Si tout l'obstacle est au-dessus, et à gauche, on projete tout sur y=0 => m3 m4
		else if (obst.y < py && obst.y+obst.h < py && px > obst.x+obst.w) {
			ctxS.moveTo(obst.x+obst.w, obst.y); //m3
			ctxS.lineTo(obst.x+obst.w+(0-obst.y)/m3, 0);
			ctxS.lineTo(obst.x+(0-obst.y-obst.h)/m4, 0);
			ctxS.lineTo(obst.x, obst.y+obst.h); //m4
			ctxS.lineTo(obst.x, obst.y);
		}
		//Si l'obstacle est au dessus mais entre les 2 => m4 m2
		else if (obst.y < py && obst.y+obst.h < py) {
			ctxS.moveTo(obst.x, obst.y+obst.h); //m4
			ctxS.lineTo(obst.x+(0-obst.y-obst.h)/m4, 0);
			ctxS.lineTo(obst.x+obst.w+(0-obst.y-obst.h)/m2, 0);
			ctxS.lineTo(obst.x+obst.w, obst.y+obst.h); //m2
			ctxS.lineTo(obst.x+obst.w, obst.y); //m3
			ctxS.lineTo(obst.x, obst.y); //m
		}
		// Si tout l'obstacle est en-dessous, et à gauche, on projete tout sur y=ch =>m m2
		else if (obst.y > py && obst.y+obst.h > py && px > obst.x+obst.w) {
			ctxS.moveTo(obst.x, obst.y); //m
			ctxS.lineTo(obst.x+(ch-obst.y)/m, ch);
			ctxS.lineTo(obst.x+obst.w+(ch-obst.y-obst.h)/m2, ch);
			ctxS.lineTo(obst.x+obst.w, obst.y+obst.h); //m2
			ctxS.lineTo(obst.x, obst.y+obst.h); //m4
		}
		// Si tout l'obstacle est en-dessous, et à droite, on projete tout sur y=ch =>m3 m4
		else if (obst.y > py && obst.y+obst.h > py && px < obst.x) {
			ctxS.moveTo(obst.x+obst.w, obst.y); //m3
			ctxS.lineTo(obst.x+obst.w+(ch-obst.y)/m3, ch);
			ctxS.lineTo(obst.x+(ch-obst.y-obst.h)/m4, ch);
			ctxS.lineTo(obst.x, obst.y+obst.h); //m4
			ctxS.lineTo(obst.x+obst.w, obst.y+obst.h); //m2
		}
		//Si l'obstacle est en dessous mais entre les 2 => m m3
		else if (obst.y > py && obst.y+obst.h > py) {
			ctxS.moveTo(obst.x, obst.y); //m
			ctxS.lineTo(obst.x+(ch-obst.y)/m, ch);
			ctxS.lineTo(obst.x+obst.w+(ch-obst.y)/m3, ch);
			ctxS.lineTo(obst.x+obst.w, obst.y); //m3
			ctxS.lineTo(obst.x+obst.w, obst.y+obst.h); //m2
			ctxS.lineTo(obst.x, obst.y+obst.h); //m4
		}
		//Si l'obstacle est à ma gauche à mihauteur => m3 sur 0, m2 sur ch ON DEVRAIT PROJETER SUR X0
		else if (obst.x+obst.w < px) {
			ctxS.moveTo(obst.x+obst.w, obst.y); //m3
			ctxS.lineTo(0, m3*(0-obst.x-obst.w)+obst.y);
			ctxS.lineTo(0, m2*(0-obst.x-obst.w)+obst.y+obst.h);
			ctxS.lineTo(obst.x+obst.w, obst.y+obst.h); //m2
			ctxS.lineTo(obst.x, obst.y+obst.h); //m4
			ctxS.lineTo(obst.x, obst.y); //m		
		}
		//Si l'obstacle est à ma droite à mihauteur => m sur 0, m4 sur ch
		else {
			ctxS.moveTo(obst.x, obst.y); //m
			ctxS.lineTo(cw, m*(cw-obst.x)+obst.y);
			ctxS.lineTo(cw, m4*(cw-obst.x)+obst.y+obst.h);
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
	ctxShoot.drawImage(imgImp, x-6, y-6, 12, 12);
	if (debug) console.log("Draw impact");
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
		row.insertCell().innerHTML = players[playerId].username;
		row.insertCell().innerHTML = players[playerId].scores.hit;
		row.insertCell().innerHTML = players[playerId].scores.kill;
		row.insertCell().innerHTML = players[playerId].scores.ff;
		row.insertCell().innerHTML = players[playerId].scores.fk;
		row.insertCell().innerHTML = players[playerId].scores.kill*5 + players[playerId].scores.hit - players[playerId].scores.ff*2 - players[playerId].scores.fk*10;
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