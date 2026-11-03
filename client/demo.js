// client/demo.js — spécifique à la page démo (/demo.html)

// Adaptation à l'écran mobile : mise à l'échelle de la zone de jeu (800x500)
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
