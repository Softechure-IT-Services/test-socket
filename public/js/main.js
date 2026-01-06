const socket = io();
const peers = {};
let localStream;
let screenStream;
let isScreenSharing = false;
let originalVideoTrack;
let currentRoom = null;
let username = "";
let isInCall = false;
let pendingCall = null;
let hasCamera = false;
let hasMicrophone = false;
let screenShareUserId = null;
let audioContext = null;
let silentAudioTrack = null;
let deviceCheckInterval = null;

// Monitor device changes
navigator.mediaDevices.addEventListener('devicechange', async () => {
  console.log("Device change detected!");
  if (isInCall) {
    await checkAndUpdateDevices();
  }
});

// DOM Elements
const usernameScreen = document.getElementById("usernameScreen");
const mainApp = document.getElementById("mainApp");
const usernameInput = document.getElementById("usernameInput");
const continueBtn = document.getElementById("continueBtn");
const userInitial = document.getElementById("userInitial");
const displayUsername = document.getElementById("displayUsername");
const preview = document.getElementById("preview");
const videos = document.getElementById("videos");
const userList = document.getElementById("userList");
const noUsers = document.getElementById("noUsers");
const prejoin = document.getElementById("prejoin");
const meeting = document.getElementById("meeting");
const roomName = document.getElementById("roomName");
const incomingCallModal = document.getElementById("incomingCallModal");
const callerName = document.getElementById("callerName");
const callerInitial = document.getElementById("callerInitial");
const toastContainer = document.getElementById("toastContainer");
const roomInput = document.getElementById("roomInput");
const createRoomBtn = document.getElementById("createRoomBtn");
const sidebar = document.getElementById("sidebar");
const openSidebar = document.getElementById("openSidebar");
const closeSidebar = document.getElementById("closeSidebar");

// Mobile Sidebar Toggle
openSidebar.addEventListener("click", () => {
  sidebar.classList.add("open");
});

closeSidebar.addEventListener("click", () => {
  sidebar.classList.remove("open");
});

// Close sidebar when clicking outside on mobile
document.addEventListener("click", (e) => {
  if (window.innerWidth < 768) {
    if (!sidebar.contains(e.target) && !openSidebar.contains(e.target)) {
      sidebar.classList.remove("open");
    }
  }
});

// Username Setup
usernameInput.addEventListener("input", () => {
  continueBtn.disabled = usernameInput.value.trim().length === 0;
});

usernameInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter" && usernameInput.value.trim()) {
    setupUsername();
  }
});

continueBtn.addEventListener("click", setupUsername);

async function setupUsername() {
  username = usernameInput.value.trim();
  if (!username) return;

  userInitial.textContent = username[0].toUpperCase();
  displayUsername.textContent = username;

  usernameScreen.classList.add("hidden");
  mainApp.classList.remove("hidden");

  socket.emit("set-username", username);
  await startPreview();
}

// Start Preview
async function startPreview() {
  try {
    // Try to get both video and audio
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });
    preview.srcObject = localStream;
    hasCamera = true;
    hasMicrophone = true;
    updateDeviceButtons();
  } catch (err) {
    console.log("Failed to get video and audio, trying alternatives...");
    
    // Try video only
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false
      });
      preview.srcObject = localStream;
      hasCamera = true;
      hasMicrophone = false;
      updateDeviceButtons();
      showToast("Microphone not available, continuing with video only", "warning");
    } catch (videoErr) {
      console.log("No video available, trying audio only...");
      
      // Try audio only
      try {
        localStream = await navigator.mediaDevices.getUserMedia({
          video: false,
          audio: true
        });
        // Create a black video track for audio-only users
        const canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 480;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#1f2937';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Draw user initial
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 120px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(username[0].toUpperCase(), canvas.width / 2, canvas.height / 2);
        
        const dummyStream = canvas.captureStream(1);
        const videoTrack = dummyStream.getVideoTracks()[0];
        localStream.addTrack(videoTrack);
        
        preview.srcObject = localStream;
        hasCamera = false;
        hasMicrophone = true;
        updateDeviceButtons();
        showToast("Camera not available, continuing with audio only", "warning");
      } catch (audioErr) {
        console.log("No audio/video available, creating dummy stream...");
        
        // Create a dummy stream with no real media
        const canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 480;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#1f2937';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Draw user initial
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 120px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(username ? username[0].toUpperCase() : '?', canvas.width / 2, canvas.height / 2);
        
        localStream = canvas.captureStream(1);
        
        // Add silent audio track
        audioContext = new AudioContext();
        const oscillator = audioContext.createOscillator();
        const dst = oscillator.connect(audioContext.createMediaStreamDestination());
        oscillator.start();
        silentAudioTrack = dst.stream.getAudioTracks()[0];
        silentAudioTrack.enabled = false;
        localStream.addTrack(silentAudioTrack);
        
        preview.srcObject = localStream;
        hasCamera = false;
        hasMicrophone = false;
        updateDeviceButtons();
        showToast("No camera/microphone available. You can still share your screen!", "info");
      }
    }
  }
}

async function checkAndUpdateDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter(d => d.kind === 'audioinput');
    const videoInputs = devices.filter(d => d.kind === 'videoinput');
    
    const hasAudioInput = audioInputs.length > 0;
    const hasVideoInput = videoInputs.length > 0;

    // --- MICROPHONE HANDLING ---
    if (!hasMicrophone && hasAudioInput) {
      console.log("🎤 New microphone detected. Attempting to acquire...");
      try {
        const audioStream = await navigator.mediaDevices.getUserMedia({ 
          audio: { echoCancellation: true, noiseSuppression: true } 
        });
        const newAudioTrack = audioStream.getAudioTracks()[0];

        // 1. Properly stop and remove the old track (silent or dead hardware)
        const oldAudioTrack = localStream.getAudioTracks()[0];
        if (oldAudioTrack) {
          oldAudioTrack.stop(); // Stops the hardware/context
          localStream.removeTrack(oldAudioTrack);
        }

        // 2. Add the new real track to local stream
        localStream.addTrack(newAudioTrack);
        preview.srcObject = localStream;

        // 3. Update all Peer Connections
        for (const [peerId, peerData] of Object.entries(peers)) {
          const { pc } = peerData;
          await waitForStableState(pc); // Ensure we aren't mid-negotiation

          const audioSender = pc.getSenders().find(s => s.track?.kind === "audio");

          if (audioSender) {
            // Seamlessly swap the track without needing a full renegotiation handshake
            await audioSender.replaceTrack(newAudioTrack);
            console.log(`✅ Audio track replaced for peer: ${peerId}`);
          } else {
            // If no sender existed (e.g., started with no mic), we must add and renegotiate
            pc.addTrack(newAudioTrack, localStream);
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            socket.emit("renegotiate", { to: peerId, offer });
          }
        }

        // 4. Update local state and notify peers to "nudge" their audio
        hasMicrophone = true;
        updateDeviceButtons();
        socket.emit("peer-audio-updated", { roomId: currentRoom }); 
        showToast("🎤 Microphone connected and active!", "success");
        testAudioLevel(newAudioTrack);

      } catch (err) {
        console.error("❌ Failed to switch to new microphone:", err);
      }
    }

    // --- CAMERA HANDLING ---
    if (!hasCamera && hasVideoInput) {
      console.log("📹 New camera detected. Attempting to acquire...");
      try {
        const videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
        const newVideoTrack = videoStream.getVideoTracks()[0];

        if (!isScreenSharing) {
          const oldVideoTrack = localStream.getVideoTracks()[0];
          if (oldVideoTrack) {
            oldVideoTrack.stop();
            localStream.removeTrack(oldVideoTrack);
          }
          
          localStream.addTrack(newVideoTrack);
          originalVideoTrack = newVideoTrack;

          for (const [peerId, peerData] of Object.entries(peers)) {
            const { pc } = peerData;
            const videoSender = pc.getSenders().find(s => s.track?.kind === "video");
            if (videoSender) {
              await videoSender.replaceTrack(newVideoTrack);
            } else {
              pc.addTrack(newVideoTrack, localStream);
            }
          }
          
          preview.srcObject = localStream;
        }

        hasCamera = true;
        updateDeviceButtons();
        showToast("📹 Camera connected!", "success");
      } catch (err) {
        console.error("❌ Failed to switch to new camera:", err);
      }
    }
  } catch (err) {
    console.error("❌ Error during device check:", err);
  }
}

// Test audio level to verify microphone is working
function testAudioLevel(audioTrack) {
  const stream = new MediaStream([audioTrack]);
  const audioContext = new AudioContext();
  const analyser = audioContext.createAnalyser();
  const microphone = audioContext.createMediaStreamSource(stream);
  const dataArray = new Uint8Array(analyser.frequencyBinCount);
  
  microphone.connect(analyser);
  analyser.fftSize = 256;
  
  let checkCount = 0;
  const checkAudio = () => {
    analyser.getByteFrequencyData(dataArray);
    const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
    
    if (average > 10) {
      console.log("✓ Microphone is working! Audio level:", average);
      audioContext.close();
    } else if (checkCount++ < 50) {
      requestAnimationFrame(checkAudio);
    } else {
      console.log("⚠ No audio detected from microphone. Please check if it's enabled in system settings.");
      audioContext.close();
    }
  };
  
  setTimeout(checkAudio, 1000); // Wait 1 second before testing
}

// Update device button styles
function updateDeviceButtons() {
  const micBtns = [document.getElementById("toggleMic"), document.getElementById("meetingToggleMic")];
  const camBtns = [document.getElementById("toggleCam"), document.getElementById("meetingToggleCam")];
  
  micBtns.forEach(btn => {
    if (btn) {
      if (!hasMicrophone) {
        btn.classList.add("bg-yellow-600", "hover:bg-yellow-700", "device-warning");
        btn.classList.remove("bg-gray-800", "hover:bg-gray-700", "bg-red-600", "hover:bg-red-700");
      }
    }
  });
  
  camBtns.forEach(btn => {
    if (btn) {
      if (!hasCamera) {
        btn.classList.add("bg-yellow-600", "hover:bg-yellow-700", "device-warning");
        btn.classList.remove("bg-gray-800", "hover:bg-gray-700", "bg-red-600", "hover:bg-red-700");
      }
    }
  });
}

// Toast Notifications
function showToast(message, type = "info") {
  const toast = document.createElement("div");
  toast.className = `toast px-6 py-4 rounded-lg shadow-lg text-white ${
    type === "error" ? "bg-red-600" :
    type === "success" ? "bg-green-600" :
    type === "warning" ? "bg-yellow-600" :
    "bg-blue-600"
  }`;
  toast.textContent = message;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(-20px)";
    toast.style.transition = "all 0.3s";
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// Socket Events - User List
socket.on("update-user-list", (users) => {
  userList.innerHTML = "";
  const otherUsers = users.filter(u => u.id !== socket.id);
  
  if (otherUsers.length === 0) {
    noUsers.classList.remove("hidden");
  } else {
    noUsers.classList.add("hidden");
  }

  otherUsers.forEach(user => {
    console.log(`user ${user.username}`);
    
    if(user.username != null){
      const userCard = document.createElement("div");
      userCard.className = "bg-gray-800 hover:bg-gray-750 rounded-lg p-3 cursor-pointer transition border border-gray-700 hover:border-gray-600";
      
      const initial = user.username ? user.username[0].toUpperCase() : "?";
      userCard.innerHTML = `
        <div class="flex items-center space-x-3">
          <div class="bg-gradient-to-br from-green-500 to-teal-600 w-10 h-10 rounded-full flex items-center justify-center font-bold">
            ${initial}
          </div>
          <div class="flex-1">
            <h4 class="font-semibold">${user.username || "Anonymous"}</h4>
            <p class="text-xs text-gray-400">${user.inCall ? "In a call" : "Available"}</p>
          </div>
          <button class="call-btn bg-blue-600 hover:bg-blue-700 w-10 h-10 rounded-full flex items-center justify-center transition ${user.inCall ? "opacity-50 cursor-not-allowed" : ""}">
            <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z"/>
            </svg>
          </button>
        </div>
      `;
  
      const callBtn = userCard.querySelector(".call-btn");
      callBtn.onclick = (e) => {
        e.stopPropagation();
        if (!user.inCall) {
          initiateCall(user.id, user.username);
        }
      };
  
      userList.appendChild(userCard);
      
    }
  });
});

// Initiate Call
function initiateCall(userId, targetUsername) {
  if (isInCall) {
    showToast("Please leave your current call first", "warning");
    return;
  }

  const roomId = `room-${socket.id}-${userId}`;
  socket.emit("call-user", { to: userId, roomId, callerName: username });
  showToast(`Calling ${targetUsername}...`, "info");
}

// Create/Join Room
createRoomBtn.addEventListener("click", () => {
  const roomId = roomInput.value.trim();
  if (!roomId) {
    showToast("Please enter a room ID", "warning");
    return;
  }

  if (isInCall) {
    showToast("Please leave your current call first", "warning");
    return;
  }

  joinRoom(roomId, `Room: ${roomId}`);
  roomInput.value = "";
});

// Incoming Call
socket.on("incoming-call", ({ from, roomId, callerName: caller }) => {
  if (isInCall) {
    socket.emit("call-rejected", { to: from, reason: "busy" });
    return;
  }

  pendingCall = { from, roomId, callerName: caller };
  callerName.textContent = caller || "Unknown";
  callerInitial.textContent = caller ? caller[0].toUpperCase() : "?";
  incomingCallModal.classList.remove("hidden");
});

// Accept Call
document.getElementById("acceptCallBtn").onclick = () => {
  if (!pendingCall) return;

  incomingCallModal.classList.add("hidden");
  socket.emit("call-accepted", { to: pendingCall.from, roomId: pendingCall.roomId });
  joinRoom(pendingCall.roomId, pendingCall.callerName);
  pendingCall = null;
};

// Reject Call
document.getElementById("rejectCallBtn").onclick = () => {
  if (!pendingCall) return;

  socket.emit("call-rejected", { to: pendingCall.from, reason: "declined" });
  incomingCallModal.classList.add("hidden");
  pendingCall = null;
};

// Call Accepted
socket.on("call-accepted", ({ roomId }) => {
  joinRoom(roomId, "Call");
});

// Call Rejected
socket.on("call-rejected", ({ reason }) => {
  const message = reason === "busy" ? "User is currently in another call" : "Call declined";
  showToast(message, "error");
});

// Join Room
function joinRoom(roomId, displayName = "Room") {
  currentRoom = roomId;
  isInCall = true;
  prejoin.classList.add("hidden");
  meeting.classList.remove("hidden");
  roomName.textContent = displayName;
  
  addVideoStream("local", localStream, true, username);
  socket.emit("join-room", roomId);
  socket.emit("update-call-status", true);
  
  // Start periodic device check (every 3 seconds)
  deviceCheckInterval = setInterval(() => {
    checkAndUpdateDevices();
  }, 3000);
  
  showToast("Joined the room. Monitoring for new devices...", "success");
}

// Pre-join Controls
document.getElementById("toggleMic").onclick = toggleMic;
document.getElementById("toggleCam").onclick = toggleCam;
document.getElementById("meetingToggleMic").onclick = toggleMic;
document.getElementById("meetingToggleCam").onclick = toggleCam;
document.getElementById("refreshDevicesBtn").onclick = () => {
  checkAndUpdateDevices();
  showToast("Checking for new devices...", "info");
};

function toggleMic() {
  if (!hasMicrophone) {
    showToast("No microphone available. Connect a microphone to enable audio.", "warning");
    return;
  }
  
  const track = localStream.getAudioTracks()[0];
  if (track && track !== silentAudioTrack) {
    track.enabled = !track.enabled;
    
    const btns = [document.getElementById("toggleMic"), document.getElementById("meetingToggleMic")];
    btns.forEach(btn => {
      if (btn) {
        btn.classList.toggle("bg-red-600", !track.enabled);
        btn.classList.toggle("hover:bg-red-700", !track.enabled);
        btn.classList.toggle("bg-gray-800", track.enabled);
        btn.classList.toggle("hover:bg-gray-700", track.enabled);
      }
    });
  }
}

function toggleCam() {
  if (!hasCamera) {
    showToast("No camera available. Connect a camera to enable video.", "warning");
    return;
  }
  
  const track = localStream.getVideoTracks()[0];
  if (track && track.label !== 'canvas') {
    track.enabled = !track.enabled;
    
    const btns = [document.getElementById("toggleCam"), document.getElementById("meetingToggleCam")];
    btns.forEach(btn => {
      if (btn) {
        btn.classList.toggle("bg-red-600", !track.enabled);
        btn.classList.toggle("hover:bg-red-700", !track.enabled);
        btn.classList.toggle("bg-gray-800", track.enabled);
        btn.classList.toggle("hover:bg-gray-700", track.enabled);
      }
    });
  }
}

// Socket Events - WebRTC
socket.on("existing-users", users => {
  users.forEach(userData => createPeer(userData.id, userData.username, true));
});

socket.on("user-joined", userData => {
  createPeer(userData.id, userData.username, false);
});

socket.on("offer", async ({ from, offer, username: peerUsername }) => {
  const pc = createPeer(from, peerUsername, false);
  await pc.setRemoteDescription(offer);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit("answer", { to: from, answer });
});

socket.on("answer", async ({ from, answer }) => {
  await peers[from].pc.setRemoteDescription(answer);
  console.log(`✅ Set answer from peer ${from}`);
});

// Handle renegotiation
socket.on("renegotiate", async ({ from, offer }) => {
  console.log(`🔄 Received renegotiation offer from peer ${from}`);
  const pc = peers[from]?.pc;
  
  if (pc) {
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("renegotiate-answer", { to: from, answer });
      console.log(`✅ Sent renegotiation answer to peer ${from}`);
    } catch (err) {
      console.error(`❌ Renegotiation failed with peer ${from}:`, err);
    }
  }
});

socket.on("renegotiate-answer", async ({ from, answer }) => {
  console.log(`🔄 Received renegotiation answer from peer ${from}`);
  const pc = peers[from]?.pc;
  
  if (pc) {
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
      console.log(`✅ Renegotiation complete with peer ${from}`);
    } catch (err) {
      console.error(`❌ Failed to set renegotiation answer from peer ${from}:`, err);
    }
  }
});

socket.on("icecandidate", ({ from, candidate }) => {
  peers[from]?.pc.addIceCandidate(candidate);
});

socket.on("user-left", id => {
  if (peers[id]) {
    peers[id].pc.close();
    delete peers[id];
  }
  document.getElementById(`video-${id}`)?.remove();
  
  // Check if the leaving user was screen sharing
  if (screenShareUserId === id) {
    screenShareUserId = null;
    reorganizeVideoLayout();
  }
});

// Screen share status from peers
socket.on("peer-screen-share-status", ({ userId, sharing }) => {
  if (sharing) {
    screenShareUserId = userId;
    const container = document.getElementById(`video-${userId}`);
    if (container) {
      container.classList.add('screen-share');
      
      // Add badge if not exists
      if (!container.querySelector('.screen-share-badge')) {
        const badge = document.createElement("div");
        badge.className = "screen-share-badge";
        badge.innerHTML = `
          <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M3 5a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2h-2.22l.123.489.804.804A1 1 0 0113 18H7a1 1 0 01-.707-1.707l.804-.804L7.22 15H5a2 2 0 01-2-2V5zm5.771 7H5V5h10v7H8.771z" clip-rule="evenodd"/>
          </svg>
          <span>Screen Sharing</span>
        `;
        container.appendChild(badge);
      }
    }
  } else {
    if (screenShareUserId === userId) {
      screenShareUserId = null;
    }
    const container = document.getElementById(`video-${userId}`);
    if (container) {
      container.classList.remove('screen-share');
      container.querySelector('.screen-share-badge')?.remove();
    }
  }
  reorganizeVideoLayout();
});

// Handle audio track updates from peers
// socket.on("peer-audio-updated", ({ from }) => {
//   console.log(`🔊 Peer ${from} updated their audio track`);
  
//   // Get the peer's video element
//   const videoElement = document.querySelector(`#video-${from} video`);


//   const container = document.getElementById(`video-${from}`);
//   if (container) {
//     const video = container.querySelector("video");
//     // Re-triggering play helps mobile browsers re-sync the audio pipeline
//     video.play().catch(err => console.log("Nudge failed:", err));
//     console.log(`🔔 Nudged audio for peer ${from} due to device change`);
//   }



//   if (videoElement && videoElement.srcObject) {
//     const stream = videoElement.srcObject;
//     const audioTracks = stream.getAudioTracks();
    
//     console.log(`Peer ${from} audio tracks:`, audioTracks.length);
    
//     if (audioTracks.length > 0) {
//       audioTracks.forEach((track, idx) => {
//         console.log(`Audio track ${idx}:`, track.label, 'enabled:', track.enabled, 'readyState:', track.readyState);
        
//         // Ensure track is enabled
//         track.enabled = true;
//       });
      
//       // Force video element to refresh
//       videoElement.load();
//       videoElement.play().then(() => {
//         console.log(`✅ Refreshed audio playback for peer ${from}`);
//       }).catch(err => {
//         console.log(`⚠️ Could not auto-play for peer ${from}:`, err);
//       });
//     }
//   }
// });

// When a peer updates their hardware, "nudge" the local video element to play
socket.on("peer-audio-updated", ({ from }) => {
  console.log(`🔊 Peer ${from} swapped hardware. Refreshing audio playback...`);
  
  const container = document.getElementById(`video-${from}`);
  if (container) {
    const video = container.querySelector("video");
    // Mobile browsers often pause the stream if the source track "ends"
    // Re-calling .play() forces the browser to re-attach to the new track
    video.play().catch(err => {
      console.warn("Auto-nudge blocked. Waiting for user interaction.", err);
    });
  }
});
// Peer Connection
function createPeer(id, peerUsername, initiator) {
  if (peers[id]) return peers[id].pc;

  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  });

  peers[id] = { pc, username: peerUsername };

  // Add all available tracks to peer connection
  if (localStream) {
    localStream.getTracks().forEach(t => {
      try {
        pc.addTrack(t, localStream);
      } catch (err) {
        console.log("Error adding track:", err);
      }
    });
  }

  // pc.ontrack = e => {
  //   console.log(`📥 Received ${e.track.kind} track from peer ${id}:`, e.track.label, 'readyState:', e.track.readyState);
    
  //   // Store the stream reference
  //   if (!peers[id].remoteStream) {
  //     peers[id].remoteStream = e.streams[0];
  //   }
    
  //   addVideoStream(id, e.streams[0], false, peerUsername);
    
  //   // Ensure audio plays on mobile devices
  //   if (e.track.kind === 'audio') {
  //     const audioElement = document.querySelector(`#video-${id} video`);
  //     if (audioElement) {
  //       console.log(`🔊 Setting up audio for peer ${id}`);
  //       audioElement.muted = false;
  //       audioElement.volume = 1.0;
        
  //       // Monitor track state changes
  //       e.track.onended = () => {
  //         console.log(`❌ Audio track ended for peer ${id}`);
  //       };
        
  //       e.track.onmute = () => {
  //         console.log(`🔇 Audio track muted for peer ${id}`);
  //       };
        
  //       e.track.onunmute = () => {
  //         console.log(`🔊 Audio track unmuted for peer ${id}`);
  //       };
        
  //       // Force audio playback
  //       setTimeout(() => {
  //         audioElement.play().then(() => {
  //           console.log(`✅ Audio playing for peer ${id}`);
  //         }).catch(err => {
  //           console.log(`⚠️ Audio playback blocked for peer ${id}:`, err);
  //           // Retry on user interaction
  //           document.addEventListener('click', () => {
  //             audioElement.play().then(() => {
  //               console.log(`✅ Audio started after user interaction for peer ${id}`);
  //             }).catch(e => console.log(`❌ Retry failed for peer ${id}:`, e));
  //           }, { once: true });
  //         });
  //       }, 100);
  //     }
  //   }
  // };


  pc.ontrack = e => {
  const stream = e.streams[0];
  const isScreen = e.track.label.toLowerCase().includes("screen");

  addVideoStream(
    isScreen ? `screen-${id}` : id,
    stream,
    false,
    isScreen ? `${peerUsername} (Screen)` : peerUsername,
    isScreen
  );
};


  // Monitor connection state
  pc.onconnectionstatechange = () => {
    console.log(`Peer ${id} connection state:`, pc.connectionState);
  };

  pc.oniceconnectionstatechange = () => {
    console.log(`Peer ${id} ICE connection state:`, pc.iceConnectionState);
  };

  pc.onicecandidate = e => {
    if (e.candidate) {
      socket.emit("icecandidate", { to: id, candidate: e.candidate });
    }
  };

  if (initiator) {
    pc.createOffer().then(offer => {
      pc.setLocalDescription(offer);
      socket.emit("offer", { to: id, offer });
    });
  }

  return pc;
}

// Video Handler
function addVideoStream(id, stream, muted = false, displayName = "User", isScreenShare = false) {
  let container = document.getElementById(`video-${id}`);
  if (!container) {
    container = document.createElement("div");
    container.id = `video-${id}`;
    container.className = "video-container bg-gray-800 rounded-lg md:rounded-xl overflow-hidden shadow-lg border border-gray-700";
    
    if (isScreenShare) {
      container.classList.add("screen-share");
    }
    
    const video = document.createElement("video");
    video.autoplay = true;
    video.playsInline = true;
    video.muted = muted;
    video.className = "w-full h-full";
    
    // Critical for mobile audio playback
    if (!muted) {
      video.volume = 1.0;
      video.setAttribute('playsinline', 'true');
      video.setAttribute('webkit-playsinline', 'true');
    }
    
    const label = document.createElement("div");
    label.className = "video-label";
    label.textContent = id === "local" ? `${displayName} (You)` : displayName;
    
    container.appendChild(video);
    container.appendChild(label);
    
    if (isScreenShare) {
      const badge = document.createElement("div");
      badge.className = "screen-share-badge";
      badge.innerHTML = `
        <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path fill-rule="evenodd" d="M3 5a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2h-2.22l.123.489.804.804A1 1 0 0113 18H7a1 1 0 01-.707-1.707l.804-.804L7.22 15H5a2 2 0 01-2-2V5zm5.771 7H5V5h10v7H8.771z" clip-rule="evenodd"/>
        </svg>
        <span>Screen Sharing</span>
      `;
      container.appendChild(badge);
    }
    
    videos.appendChild(container);
  }
  
  const videoElement = container.querySelector("video");
  videoElement.srcObject = stream;
  
  // Ensure audio tracks are enabled and playing
  if (!muted) {
    const audioTracks = stream.getAudioTracks();
    console.log(`Video ${id} has ${audioTracks.length} audio tracks`);
    audioTracks.forEach((track, index) => {
      console.log(`Audio track ${index}:`, track.label, 'enabled:', track.enabled, 'muted:', track.muted);
      track.enabled = true;
    });
    
    // Force play for remote streams
    videoElement.play().catch(err => {
      console.log(`Autoplay prevented for ${id}, will retry on interaction:`, err);
      // Add click handler to start playback
      const playOnClick = () => {
        videoElement.play().then(() => {
          console.log(`Started playback for ${id} after user interaction`);
          document.removeEventListener('click', playOnClick);
        }).catch(e => console.log(`Play failed for ${id}:`, e));
      };
      document.addEventListener('click', playOnClick, { once: true });
    });
  }
  
  reorganizeVideoLayout();
}

// Reorganize video layout based on screen sharing
// function reorganizeVideoLayout() {
//   const videoContainers = Array.from(videos.querySelectorAll('.video-container'));
//   const screenShareContainer = videoContainers.find(c => c.classList.contains('screen-share'));
  
//   if (screenShareContainer) {
//     videos.classList.add('has-screen-share');
    
//     // Clear and rebuild layout
//     videos.innerHTML = '';
    
//     // Add screen share first (takes full space)
//     videos.appendChild(screenShareContainer);
    
//     // Create thumbnails container for other videos
//     const thumbnailsWrapper = document.createElement('div');
//     thumbnailsWrapper.className = 'thumbnails-container';
    
//     videoContainers.forEach(container => {
//       if (!container.classList.contains('screen-share')) {
//         thumbnailsWrapper.appendChild(container);
//       }
//     });
    
//     if (thumbnailsWrapper.children.length > 0) {
//       videos.appendChild(thumbnailsWrapper);
//     }
//   } else {
//     videos.classList.remove('has-screen-share');
//   }
// }


function reorganizeVideoLayout() {
  const containers = [...videos.querySelectorAll(".video-container")];
  const screen = containers.find(c => c.classList.contains("screen-share"));

  videos.innerHTML = "";

  if (screen) {
    videos.classList.add("has-screen-share");

    videos.appendChild(screen);

    const thumbs = document.createElement("div");
    thumbs.className = "thumbnails-container";

    containers.forEach(c => {
      if (c !== screen) thumbs.appendChild(c);
    });

    videos.appendChild(thumbs);
  } else {
    videos.classList.remove("has-screen-share");
    containers.forEach(c => videos.appendChild(c));
  }
}

// Screen Share
document.getElementById("shareScreenBtn").onclick = toggleScreenShare;

async function toggleScreenShare() {
  if (!isScreenSharing) {
    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({ 
        video: true,
        audio: false 
      });
      const screenTrack = screenStream.getVideoTracks()[0];
      
      // Store original video track if it exists and is real
      const currentVideoTrack = localStream.getVideoTracks()[0];
      if (currentVideoTrack && currentVideoTrack.label !== 'canvas') {
        originalVideoTrack = currentVideoTrack;
      }

      // Replace video track in all peer connections
      Object.values(peers).forEach(({ pc }) => {
        const sender = pc.getSenders().find(s => s.track?.kind === "video");
        if (sender) {
          sender.replaceTrack(screenTrack).catch(err => {
            console.log("Error replacing track:", err);
          });
        }
      });

      // Remove old local video and add screen share version
      const oldLocal = document.getElementById('video-local');
      if (oldLocal) {
        oldLocal.remove();
      }
      
      addVideoStream("local", screenStream, true, username, true);
      screenShareUserId = "local";
      
      isScreenSharing = true;
      const shareBtn = document.getElementById("shareScreenBtn");
      if (shareBtn) shareBtn.classList.add("bg-blue-600");
      showToast("Screen sharing started", "success");

      screenTrack.onended = stopScreenShare;
      
      // Notify peers about screen share
      socket.emit("screen-share-status", { roomId: currentRoom, sharing: true });
    } catch (err) {
      console.log("Screen share error:", err);
      showToast("Failed to share screen or cancelled", "error");
    }
  } else {
    stopScreenShare();
  }
}

function stopScreenShare() {
  if (screenStream) {
    screenStream.getTracks().forEach(t => t.stop());
  }

  // Restore original video track or create new dummy if needed
  let trackToRestore = originalVideoTrack;
  
  if (!trackToRestore || trackToRestore.readyState === 'ended') {
    // Create a new dummy track if no original track
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 120px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(username[0].toUpperCase(), canvas.width / 2, canvas.height / 2);
    
    const dummyStream = canvas.captureStream(1);
    trackToRestore = dummyStream.getVideoTracks()[0];
  }

  // Replace screen track back to camera/dummy in all peer connections
  Object.values(peers).forEach(({ pc }) => {
    const sender = pc.getSenders().find(s => s.track?.kind === "video");
    if (sender && trackToRestore) {
      sender.replaceTrack(trackToRestore).catch(err => {
        console.log("Error restoring track:", err);
      });
    }
  });

  // Remove screen share video and add back normal local video
  const oldLocal = document.getElementById('video-local');
  if (oldLocal) {
    oldLocal.remove();
  }
  
  addVideoStream("local", localStream, true, username, false);
  screenShareUserId = null;

  isScreenSharing = false;
  const shareBtn = document.getElementById("shareScreenBtn");
  if (shareBtn) shareBtn.classList.remove("bg-blue-600");
  showToast("Screen sharing stopped", "info");
  
  // Notify peers about screen share stop
  socket.emit("screen-share-status", { roomId: currentRoom, sharing: false });
}

// Leave Meeting
document.getElementById("leaveBtn").onclick = leaveMeeting;

function leaveMeeting() {
  // Clear device check interval
  if (deviceCheckInterval) {
    clearInterval(deviceCheckInterval);
    deviceCheckInterval = null;
  }
  
  Object.values(peers).forEach(({ pc }) => pc.close());
  Object.keys(peers).forEach(id => delete peers[id]);
  
  videos.innerHTML = "";
  
  if (screenStream) {
    screenStream.getTracks().forEach(t => t.stop());
    isScreenSharing = false;
  }
  
  // Clean up audio context
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }

  socket.emit("leave-room", currentRoom);
  socket.emit("update-call-status", false);
  
  currentRoom = null;
  isInCall = false;
  screenShareUserId = null;
  
  meeting.classList.add("hidden");
  prejoin.classList.remove("hidden");
  
  showToast("You left the call", "info");
}



// // DOM Elements for Selection
// const micSelect = document.getElementById("micSelect");
// const camSelect = document.getElementById("camSelect");

// // 1. Function to fill the dropdown lists with available hardware
// async function updateDeviceList() {
//   try {
//     const devices = await navigator.mediaDevices.enumerateDevices();
    
//     // Clear existing options
//     micSelect.innerHTML = "";
//     camSelect.innerHTML = "";

//     devices.forEach(device => {
//       const option = document.createElement("option");
//       option.value = device.deviceId;
//       option.text = device.label || `${device.kind} (${device.deviceId.slice(0, 5)}...)`;

//       if (device.kind === "audioinput") {
//         micSelect.appendChild(option);
//       } else if (device.kind === "videoinput") {
//         camSelect.appendChild(option);
//       }
//     });
    
//     console.log("📱 Device list updated");
//   } catch (err) {
//     console.error("Error enumerating devices:", err);
//   }
// }

// // 2. Handle Manual Device Selection
// micSelect.onchange = () => switchDevice('audio', micSelect.value);
// camSelect.onchange = () => switchDevice('video', camSelect.value);

// async function switchDevice(type, deviceId) {
//   try {
//     const constraints = {
//       audio: type === 'audio' ? { deviceId: { exact: deviceId } } : true,
//       video: type === 'video' ? { deviceId: { exact: deviceId } } : true
//     };

//     const newStream = await navigator.mediaDevices.getUserMedia(constraints);
//     const newTrack = type === 'audio' ? newStream.getAudioTracks()[0] : newStream.getVideoTracks()[0];

//     // Replace the track in our local reference
//     const oldTrack = type === 'audio' ? localStream.getAudioTracks()[0] : localStream.getVideoTracks()[0];
//     if (oldTrack) {
//       oldTrack.stop();
//       localStream.removeTrack(oldTrack);
//     }
//     localStream.addTrack(newTrack);

//     // Update the local preview
//     preview.srcObject = localStream;
//     if (type === 'video') originalVideoTrack = newTrack;

//     // CRITICAL: Replace track for all active peers without dropping the call
//     for (const [peerId, peerData] of Object.entries(peers)) {
//       const { pc } = peerData;
//       const senders = pc.getSenders();
//       const sender = senders.find(s => s.track?.kind === type);

//       if (sender) {
//         await sender.replaceTrack(newTrack);
//         console.log(`✅ Swapped ${type} for peer ${peerId}`);
//       }
//     }

//     // If it's audio, notify peers to ensure they are playing the new source
//     if (type === 'audio') {
//       socket.emit("peer-audio-updated", { roomId: currentRoom });
//     }

//     showToast(`${type.charAt(0).toUpperCase() + type.slice(1)} switched!`, "success");
//   } catch (err) {
//     console.error(`Failed to switch ${type}:`, err);
//     showToast("Error switching device. Ensure it is not being used by another app.", "error");
//   }
// }

// // 3. Monitor for Plug/Unplug events
// navigator.mediaDevices.ondevicechange = async () => {
//   console.log("🔌 Hardware change detected (Plugged/Unplugged)");
//   await updateDeviceList();
//   showToast("Devices updated. You can now select your new hardware.", "info");
// };

// // 4. Initial call after permissions are granted in setupUsername()
// async function startApp() {
//   await setupUsername();
//   await updateDeviceList(); 
// }




// State to track known devices
let knownDevices = { audio: [], video: [] };

const micSelect = document.getElementById("micSelect");
const camSelect = document.getElementById("camSelect");

/**
 * 1. Initialize or Update the Device List
 * @param {boolean} autoSwitch - If true, will automatically switch to a newly detected device
 */
async function refreshDeviceList(autoSwitch = false) {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        
        const currentAudioInputs = devices.filter(d => d.kind === 'audioinput');
        const currentVideoInputs = devices.filter(d => d.kind === 'videoinput');

        // Identify if a NEW device was just plugged in
        let newlyDetectedMicId = null;
        if (autoSwitch) {
            newlyDetectedMicId = currentAudioInputs.find(d => 
                d.deviceId !== "" && !knownDevices.audio.includes(d.deviceId)
            )?.deviceId;
        }

        // Update the known list for next time
        knownDevices.audio = currentAudioInputs.map(d => d.deviceId);
        knownDevices.video = currentVideoInputs.map(d => d.deviceId);

        // Update UI Dropdowns
        populateSelect(micSelect, currentAudioInputs);
        populateSelect(camSelect, currentVideoInputs);

        // If a new mic was found and we are in a call, trigger the switch automatically
        if (newlyDetectedMicId && isInCall) {
            console.log("🆕 New Mic Detected:", newlyDetectedMicId);
            micSelect.value = newlyDetectedMicId; // Update UI
            await switchDevice('audio', newlyDetectedMicId); // Trigger WebRTC Swap
            showToast("Switched to new audio hardware automatically", "success");
        }

    } catch (err) {
        console.error("Error updating device list:", err);
    }
}

function populateSelect(selectElement, devices) {
    const currentValue = selectElement.value;
    selectElement.innerHTML = "";
    
    devices.forEach(device => {
        const option = document.createElement("option");
        option.value = device.deviceId;
        option.text = device.label || `Device ${device.deviceId.slice(0, 5)}`;
        selectElement.appendChild(option);
    });

    // Keep the previous selection if it still exists
    if (Array.from(selectElement.options).some(opt => opt.value === currentValue)) {
        selectElement.value = currentValue;
    }
}

/**
 * 2. The Hardware Switcher (The Core Logic)
 */
// async function switchDevice(type, deviceId) {
//     try {
//         // Stop the old track first to release hardware lock
//         const oldTracks = type === 'audio' ? localStream.getAudioTracks() : localStream.getVideoTracks();
//         oldTracks.forEach(t => t.stop());

//         // Get the new track from the specific device
//         const constraints = {
//             audio: type === 'audio' ? { deviceId: { exact: deviceId } } : true,
//             video: type === 'video' ? { deviceId: { exact: deviceId } } : true
//         };
        
//         const newStream = await navigator.mediaDevices.getUserMedia(constraints);
//         const newTrack = type === 'audio' ? newStream.getAudioTracks()[0] : newStream.getVideoTracks()[0];

//         // Replace track in localStream object
//         if (type === 'audio') {
//             const oldAudio = localStream.getAudioTracks()[0];
//             if (oldAudio) localStream.removeTrack(oldAudio);
//             localStream.addTrack(newTrack);
//         } else {
//             const oldVideo = localStream.getVideoTracks()[0];
//             if (oldVideo) localStream.removeTrack(oldVideo);
//             localStream.addTrack(newTrack);
//             originalVideoTrack = newTrack;
//         }

//         // Update Preview
//         preview.srcObject = localStream;

//         // SEAMLESS SWAP: Update all remote peers via replaceTrack
//         for (const [peerId, peerData] of Object.entries(peers)) {
//             const sender = peerData.pc.getSenders().find(s => s.track?.kind === type);
//             if (sender) {
//                 await sender.replaceTrack(newTrack);
//                 console.log(`✅ Track replaced for peer: ${peerId}`);
//             }
//         }

//         // Notify mobile/remote end to refresh audio context
//         if (type === 'audio') {
//             socket.emit("peer-audio-updated", { roomId: currentRoom });
//         }

//     } catch (err) {
//         console.error("Switch Device Error:", err);
//         showToast("Device Busy: Could not switch to selected hardware.", "error");
//     }
// }


async function switchDevice(type, deviceId) {
    try {
        console.log(`Attempting to switch ${type} to: ${deviceId}`);

        // 1. Create constraints ONLY for the requested type
        // We set the other type to 'false' so we don't try to re-open active hardware
        const constraints = {
            audio: type === 'audio' ? { deviceId: { exact: deviceId } } : false,
            video: type === 'video' ? { deviceId: { exact: deviceId } } : false
        };

        // 2. Get ONLY the new track
        const newStream = await navigator.mediaDevices.getUserMedia(constraints);
        const newTrack = newStream.getTracks()[0];

        if (!newTrack) throw new Error("Failed to acquire new track");

        // 3. Stop and Remove the OLD track from localStream
        const oldTracks = type === 'audio' ? localStream.getAudioTracks() : localStream.getVideoTracks();
        oldTracks.forEach(track => {
            track.stop(); // Releases hardware lock
            localStream.removeTrack(track);
        });

        // 4. Add the NEW track to our localStream object
        localStream.addTrack(newTrack);
        
        // Update preview and global refs
        preview.srcObject = localStream;
        if (type === 'video') originalVideoTrack = newTrack;

        // 5. Update all Peer Connections (replaceTrack is the industry standard)
        for (const [peerId, peerData] of Object.entries(peers)) {
            const senders = peerData.pc.getSenders();
            const sender = senders.find(s => s.track?.kind === type);
            
            if (sender) {
                await sender.replaceTrack(newTrack);
                console.log(`✅ Seamlessly swapped ${type} for peer: ${peerId}`);
            }
        }

        // 6. Final triggers
        if (type === 'audio') {
            socket.emit("peer-audio-updated", { roomId: currentRoom });
        }
        
        showToast(`${type.charAt(0).toUpperCase() + type.slice(1)} updated!`, "success");

    } catch (err) {
        console.error("Switch Device Error Detail:", err);
        
        // Handle specific "Busy" errors
        if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
            showToast("Device is busy. Please close other apps using the mic/camera.", "error");
        } else {
            showToast("Could not switch to the selected device.", "error");
        }
    }
}
/**
 * 3. Event Listeners
 */

// Listen for Manual Selection
micSelect.onchange = () => switchDevice('audio', micSelect.value);
camSelect.onchange = () => switchDevice('video', camSelect.value);

// Listen for Hardware Plug/Unplug
navigator.mediaDevices.ondevicechange = () => {
    console.log("🔌 Hardware change detected... waiting for drivers to settle.");
    
    // Use a small timeout (1000ms) to prevent "Device Busy" errors 
    // caused by the OS still initializing the new hardware.
    setTimeout(async () => {
        await refreshDeviceList(true); // Pass true to auto-switch
    }, 1000); 
};

// Initial Load (Call this when the app starts or user joins)
refreshDeviceList(false);