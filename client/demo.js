// client/demo.js — spécifique à la page démo (/demo.html)

// Adaptation à l'écran mobile : mise à l'échelle de la zone de jeu (800x500)
// pour qu'elle tienne dans la fenêtre, sans jamais l'agrandir (scale max 1).
// Param : aucun — Retour : aucun (modifie le style de #game).
function fitToScreen() {
	const g = document.getElementById('game');
	const scale = Math.min(window.innerWidth / 800, (window.innerHeight - 10) / 500, 1);
	g.style.transform = 'scale(' + scale + ')';
	g.style.transformOrigin = 'top left';
	g.style.marginLeft = Math.max(0, (window.innerWidth - 800 * scale) / 2) + 'px';
	g.style.marginTop = Math.max(0, (window.innerHeight - 500 * scale) / 2) + 'px';
}
window.addEventListener('resize', fitToScreen);
fitToScreen();

// Relance automatique de la démo quelques secondes après la fin de la partie
socket.on('gameEnded', () => {
	if (document.body.hasAttribute('data-demo')) {
		setTimeout(() => socket.emit('startDemo'), 6000);
	}
});

// Garde-fou : si la démo semble plantée (plus aucune mise à jour du serveur
// depuis 15 s), on redemande une partie démo
let lastServerUpdate = Date.now();
socket.on('updateAnglesAndPositions', () => { lastServerUpdate = Date.now(); });
setInterval(() => {
	if (document.body.hasAttribute('data-demo') && Date.now() - lastServerUpdate > 15000) {
		lastServerUpdate = Date.now();
		socket.emit('startDemo');
	}
}, 5000);
