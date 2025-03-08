const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState } = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');


let devices = {};
let qrCodes = {}; // Simpan QR untuk tiap device

async function connectDevice(deviceId) {
    try {
        const authFolder = path.join(__dirname, 'auth', deviceId);
        if (!fs.existsSync(authFolder)) {
        fs.mkdirSync(authFolder, { recursive: true });
        }

        const { state, saveCreds } = await useMultiFileAuthState(authFolder);
        const sock = makeWASocket({ auth: state });
        devices[deviceId] = sock;

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', (update) => {
          const { qr, connection, lastDisconnect } = update;

          if (qr) {
              qrCodes[deviceId] = qr; // Simpan QR terbaru
          }

          if (connection === 'open') {
                fetchContacts(sock);
              console.log(`Device ${deviceId} connected`);
              delete qrCodes[deviceId]; // Hapus QR setelah terhubung
          }

          if (connection === 'close') {
              console.log(`Device ${deviceId} disconnected`);
              
              if (lastDisconnect?.error) {
              console.error(`Connection Failure: ${lastDisconnect.error}`);
              
              if (lastDisconnect.error.output?.statusCode !== 401) {
                  console.log(`Reconnecting device ${deviceId} in 5 seconds...`);
                  setTimeout(() => connectDevice(deviceId), 5000);
              } else {
                  console.log(`Session expired for device ${deviceId}. Please scan QR again.`);
              }
              }
              delete devices[deviceId];
          }
        });

        return sock;
    } catch (error) {
        console.error(`Failed to connect device ${deviceId}:`, error);
        return null;
    }
}

// Auto-reconnect on server restart
function autoReconnectDevices() {
    const authPath = path.join(__dirname, '../auth');
    if (fs.existsSync(authPath)) {
      const deviceIds = fs.readdirSync(authPath);
      deviceIds.forEach((deviceId) => {
        console.log(`Auto-connecting device: ${deviceId}`);
        connectDevice(deviceId);
      });
    }
  }
  
autoReconnectDevices();

module.exports = { connectDevice, devices, qrCodes, autoReconnectDevices };