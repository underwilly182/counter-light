// client/demo-beta.js — page de pré-validation (/demo-beta.html)
// Reprend la logique de demo.js (relances, garde-fous, arrêt manuel) et
// remplace la mise à l'échelle fixe (800x500 calée dans la fenêtre) par un
// mode "plein écran" : la zone de jeu est agrandie au maximum de la fenêtre
// du navigateur, en portrait comme en paysage, desktop comme mobile.
// Aucun impact sur le vrai jeu : script.js n'est pas modifié, la zone de jeu
// reste 800x500 en interne et n'est que zoomée par transform CSS.

// Arrêt manuel : une fois la démo stoppée par le bouton, cette page ne doit
// plus jamais la relancer toute seule (watchdog, relance après fin de partie).
let demoStoppedByUser = false;
document.getElementById('kill-demo-btn').addEventListener('click', () => {
	demoStoppedByUser = true;
	socket.emit('stopDemo');
	document.getElementById('demo-stopped-msg').style.display = 'block';
});

// Relance automatique de la démo quelques secondes après la fin de la partie
socket.on('gameEnded', () => {
	if (document.body.hasAttribute('data-demo') && !demoStoppedByUser) {
		setTimeout(() => socket.emit('startDemo'), 6000);
	}
});

// Garde-fou : si la démo semble plantée (plus aucune mise à jour du serveur
// depuis 15 s), on redemande une partie démo
let lastServerUpdate = Date.now();
socket.on('updateAnglesAndPositions', () => { lastServerUpdate = Date.now(); });
setInterval(() => {
	if (document.body.hasAttribute('data-demo') && !demoStoppedByUser && Date.now() - lastServerUpdate > 15000) {
		lastServerUpdate = Date.now();
		socket.emit('startDemo');
	}
}, 5000);

// ---- Mise à l'échelle plein écran ----
// Calcul du facteur de zoom : le plus grand agrandissement qui garde TOUTE
// la zone de jeu (800x500) visible dans la fenêtre. En portrait, la zone de
// jeu occupe donc toute la largeur ; en paysage, toute la hauteur.
// Param : aucun — Retour : {number} facteur d'échelle appliqué.
function fullscreenScale() {
	const vw = window.innerWidth;
	const vh = window.innerHeight;
	return Math.min(vw / 800, vh / 500);
}

// Applique le zoom plein écran : la zone #game (800x500) est agrandie via un
// transform CSS (sans toucher à la résolution interne des canvas, donc sans
// impact sur script.js) et centrée dans la fenêtre.
// Param : aucun — Retour : aucun (modifie le style de #game).
function fitFullscreen() {
	const g = document.getElementById('game');
	const scale = fullscreenScale();
	const vw = window.innerWidth;
	const vh = window.innerHeight;
	g.style.position = 'fixed';
	g.style.transformOrigin = 'top left';
	g.style.transform = 'scale(' + scale + ')';
	g.style.left = Math.max(0, (vw - 800 * scale) / 2) + 'px';
	g.style.top = Math.max(0, (vh - 500 * scale) / 2) + 'px';
	g.style.marginLeft = '0';
	g.style.marginTop = '0';
}

// Rendu net en pixel-art lorsque la zone est agrandie (sinon floue)
document.getElementById('gameCanvas').style.imageRendering = 'pixelated';
document.getElementById('playerCanvas').style.imageRendering = 'pixelated';
document.getElementById('shootCanvas').style.imageRendering = 'pixelated';
document.getElementById('shadowCanvas').style.imageRendering = 'pixelated';

// Réapplication du zoom à chaque changement de taille ou d'orientation
window.addEventListener('resize', fitFullscreen);
window.addEventListener('orientationchange', fitFullscreen);
fitFullscreen();
