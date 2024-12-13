const socket = io();

const localVideo = document.getElementById('local-video');
const remoteVideo = document.getElementById('remote-video');

navigator.mediaDevices.getUserMedia({ video: true, audio: true })
  .then((stream) => {
    localVideo.srcObject = stream;
  })
  .catch((error) => {
    console.error('Error accessing media devices.', error);
  });
  
let peerConnection;

function createPeerConnection() {
  const config = {
    iceServers: [
      {
        urls: 'stun:stun.l.google.com:19302' // Google's public STUN server
      }
    ]
  };

  peerConnection = new RTCPeerConnection(config);

  // Handle ICE candidates
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice candidate', event.candidate, roomId);
    }
  };

  // Handle remote video stream
  peerConnection.ontrack = (event) => {
    remoteVideo.srcObject = event.streams[0];
  };

  // Add local stream to peer connection
  const localStream = localVideo.srcObject;
  for (const track of localStream.getTracks()) {
    peerConnection.addTrack(track, localStream);
  }
}

socket.on('offer', async (offer) => {
  if (!peerConnection) {
    createPeerConnection();
  }

  await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);

  socket.emit('answer', answer, roomId);
});

socket.on('answer', async (answer) => {
  await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
});

socket.on('ice candidate', async (candidate) => {
  try {
    await peerConnection.addIceCandidate(candidate);
  } catch (error) {
    console.error('Error adding received ice candidate', error);
  }
});

const roomId = 'some_room_id'; // This should be dynamically generated or input by the user

// Emit an event to join a room
socket.emit('join room', roomId);

// Listen for offers
socket.on('offer', handleOffer);

// Listen for answers
socket.on('answer', handleAnswer);

// Listen for ICE candidates
socket.on('ice candidate', handleIceCandidate);

function handleOffer(offer) {
  // Code to handle incoming offer
}

function handleAnswer(answer) {
  // Code to handle incoming answer
}

function handleIceCandidate(candidate) {
  // Code to handle incoming ICE candidate
}