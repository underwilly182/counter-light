// client/voice.js — chans vocaux d'équipe (WebRTC mesh)
// Les joueurs d'une même équipe se parlent en direct dès le lancement de la
// partie (si l'host a activé l'option), sans aucune action clavier.
// Un joueur mort ne peut plus être entendu, mais continue d'écouter son équipe.

let voiceLocalStream = null;
const voicePeers = {}; // peerId -> RTCPeerConnection

// Ferme la connexion WebRTC avec un coéquipier donné et retire son <audio>.
// Param : peerId {string} identifiant Socket.IO du coéquipier.
// Retour : aucun.
function voiceClosePeer(peerId) {
	const pc = voicePeers[peerId];
	if (pc) {
		pc.ontrack = null;
		pc.onicecandidate = null;
		try { pc.close(); } catch (e) {}
		delete voicePeers[peerId];
	}
	const el = document.getElementById('voice-audio-' + peerId);
	if (el) el.remove();
}

// Démonte entièrement le chan vocal : ferme tous les peers et coupe le micro
// local. Appelée en fin de partie ou si les chans vocaux sont désactivés.
// Param : aucun — Retour : aucun.
function voiceTeardown() {
	for (const peerId in voicePeers) voiceClosePeer(peerId);
	if (voiceLocalStream) {
		voiceLocalStream.getTracks().forEach(t => t.stop());
		voiceLocalStream = null;
	}
}

// Crée la connexion RTCPeerConnection vers un coéquipier (mesh WebRTC) :
// partage le micro local, gère les candidats ICE et la lecture de son flux.
// Param : peerId {string} identifiant Socket.IO du coéquipier.
// Retour : {RTCPeerConnection} connexion prête pour offer/answer.
function voiceCreatePeer(peerId) {
	const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
	voicePeers[peerId] = pc;
	pc.onicecandidate = (event) => {
		if (event.candidate) socket.emit('voice-ice', { to: peerId, candidate: event.candidate });
	};
	pc.ontrack = (event) => {
		let el = document.getElementById('voice-audio-' + peerId);
		if (!el) {
			el = document.createElement('audio');
			el.id = 'voice-audio-' + peerId;
			el.autoplay = true;
			el.style.display = 'none';
			document.body.appendChild(el);
		}
		el.srcObject = event.streams[0];
		// Si ce coéquipier a été muté (mort) avant que le flux arrive
		if (el.dataset.muted === '1') {
			el.volume = 0;
			event.track.enabled = false;
		}
	};
	if (voiceLocalStream) voiceLocalStream.getTracks().forEach(t => pc.addTrack(t, voiceLocalStream));
	return pc;
}

// Le serveur indique si les chans vocaux sont actifs pour cette partie
socket.on('voiceChat', async ({ enabled }) => {
	if (enabled) {
		if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
			console.warn('Chan vocal : navigateur non compatible');
			return;
		}
		try {
			voiceLocalStream = await navigator.mediaDevices.getUserMedia({ audio: true });
		} catch (e) {
			console.warn('Chan vocal : micro indisponible', e);
			return;
		}
		// Inscription au chan de son équipe (le serveur connaît l'équipe du joueur)
		socket.emit('voice-join');
	}
	else {
		voiceTeardown();
	}
});

// Le serveur confirme l'inscription et fournit les membres déjà présents :
// le nouveau arrivant initie les offres vers chacun d'eux
socket.on('voice-joined', ({ members }) => {
	(members || []).forEach(async (peerId) => {
		try {
			const pc = voiceCreatePeer(peerId);
			const offer = await pc.createOffer();
			await pc.setLocalDescription(offer);
			socket.emit('voice-offer', { to: peerId, offer });
		} catch (e) { console.warn('Chan vocal : offre échouée', e); }
	});
});

// Un coéquipier vient d'arriver : il nous enverra une offre, on prépare la connexion
socket.on('voice-peer-joined', ({ id }) => {
	if (!voicePeers[id]) voiceCreatePeer(id);
});

// Offre reçue : on répond
socket.on('voice-offer', async ({ from, offer }) => {
	try {
		const pc = voicePeers[from] || voiceCreatePeer(from);
		await pc.setRemoteDescription(new RTCSessionDescription(offer));
		const answer = await pc.createAnswer();
		await pc.setLocalDescription(answer);
		socket.emit('voice-answer', { to: from, answer });
	} catch (e) { console.warn('Chan vocal : réponse échouée', e); }
});

// Réponse reçue : la connexion est établie
socket.on('voice-answer', async ({ from, answer }) => {
	const pc = voicePeers[from];
	if (!pc) return;
	try { await pc.setRemoteDescription(new RTCSessionDescription(answer)); }
	catch (e) { console.warn('Chan vocal : description distante échouée', e); }
});

// Candidat ICE reçu
socket.on('voice-ice', async ({ from, candidate }) => {
	const pc = voicePeers[from];
	if (!pc) return;
	try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); }
	catch (e) { /* candidats arrivant avant la connexion : ignorés */ }
});

// Un joueur est mort : il ne peut plus être entendu, mais écoute toujours
socket.on('voice-mute', ({ id }) => {
	if (id === socket.id) {
		// Je suis mort : je coupe mon micro (je continue d'entendre l'équipe)
		if (voiceLocalStream) {
			voiceLocalStream.getAudioTracks().forEach(t => { t.enabled = false; });
		}
	}
	else {
		// Un coéquipier est mort : on coupe sa réception
		const el = document.getElementById('voice-audio-' + id);
		if (el) {
			el.dataset.muted = '1';
			el.volume = 0;
		}
		const pc = voicePeers[id];
		if (pc) pc.getReceivers().forEach(r => { if (r.track) r.track.enabled = false; });
	}
});

// Un coéquipier s'est déconnecté
socket.on('voice-peer-left', ({ id }) => {
	voiceClosePeer(id);
});

// Fin de la partie (ou relance) : on raccroche
socket.on('voice-chat-end', () => {
	voiceTeardown();
});
