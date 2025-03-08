// whatsapp-gateway.js
const express = require('express');
const { Boom } = require('@hapi/boom');
const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState } = require('@whiskeysockets/baileys');
const mysql = require('mysql2');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

// const db = mysql.createPool({
//     connectionLimit: 10,
//     host: process.env.DB_HOST,
//     user: process.env.DB_USER,
//     password: process.env.DB_PASSWORD,
//     database: process.env.DB_NAME
// });

// db.getConnection((err, connection) => {
//     if (err) {
//         console.error('Database connection failed:', err.message);
//         process.exit(1);
//     }
//     console.log('Connected to MySQL database');
//     connection.release();
// });

// db.on('error', (err) => {
//     console.error('MySQL error:', err.message);
// });

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
    const authPath = path.join(__dirname, 'auth');
    if (fs.existsSync(authPath)) {
      const deviceIds = fs.readdirSync(authPath);
      deviceIds.forEach((deviceId) => {
        console.log(`Auto-connecting device: ${deviceId}`);
        connectDevice(deviceId);
      });
    }
  }
  
autoReconnectDevices();

// Generate QR code for a specific device
app.get('/qr/:deviceId', async (req, res) => {
    const { deviceId } = req.params;

    if (devices[deviceId]?.ws?.readyState === 1) {
        return res.status(400).send({ error: 'Device already connected' });
    }

    try {
        if (!devices[deviceId]) {
        await connectDevice(deviceId);
        }

        if (qrCodes[deviceId]) {
        QRCode.toDataURL(qrCodes[deviceId], (err, url) => {
            if (err) {
            res.status(500).send('Error generating QR code');
            } else {
            res.send({ deviceId, qrCode: url });
            }
        });
        } else {
        res.status(404).send({ error: 'QR not available or already connected' });
        }
    } catch (error) {
        console.error('Failed to initialize device:', error);
        res.status(500).send({ error: 'Failed to initialize device', details: error.message });
    }
});

// Send a message
app.post('/send-message/:deviceId', async (req, res) => {
  const { deviceId } = req.params;
  const { number, message } = req.body;

  if (!devices[deviceId]) {
    return res.status(400).send({ error: 'Device not connected' });
  }

  try {
    await devices[deviceId].sendMessage(`${number}@s.whatsapp.net`, { text: message });
    res.send({ success: true, message: 'Message sent successfully' });
  } catch (error) {
    res.status(500).send({ error: 'Failed to send message', details: error.message });
  }
});

app.get('/list-chats/:deviceId', async (req, res) => {
  const { deviceId } = req.params;

  if (!devices[deviceId]) return res.status(400).send({ error: 'Device not connected' });

  try {
    const chats = await devices[deviceId].chatFetchAll();
    res.send({ success: true, chats });
  } catch (error) {
    res.status(500).send({ error: 'Failed to fetch chats', details: error.message });
  }
});

// List connected devices
app.get('/devices', (req, res) => {
  res.send({ connectedDevices: Object.keys(devices) });
});

// Reconnect endpoint
app.get('/reconnect/:deviceId', async (req, res) => {
  const { deviceId } = req.params;

  if (devices[deviceId]) {
    devices[deviceId].end();
    delete devices[deviceId];
  }

  await connectDevice(deviceId);
  res.send({ message: `Reconnecting device ${deviceId}...` });
});

// Send a message with button and image
app.post('/send-button-image/:deviceId', async (req, res) => {
  const { deviceId } = req.params;
  const { number, message, imageUrl, buttons, footer } = req.body;

  if (!devices[deviceId]) {
    return res.status(400).send({ error: 'Device not connected' });
  }

  try {
    const formattedButtons = buttons.map((btn) => {
      if (btn.type === 'reply') {
        return {
          index: btn.index,
          quickReplyButton: {
            displayText: btn.displayText,
            id: btn.id,
          },
        };
      } else if (btn.type === 'url') {
        return {
          index: btn.index,
          urlButton: {
            displayText: btn.displayText,
            url: btn.url,
          },
        };
      } else if (btn.type === 'call') {
        return {
          index: btn.index,
          callButton: {
            displayText: btn.displayText,
            phoneNumber: btn.phoneNumber,
          },
        };
      }
    });

    await devices[deviceId].sendMessage(`${number}@s.whatsapp.net`, {
      image: { url: imageUrl },
      caption: message,
      footer: footer || '',
      templateButtons: formattedButtons,
    });

    res.send({ success: true, message: 'Message with image and buttons sent successfully' });
  } catch (error) {
    res.status(500).send({ error: 'Failed to send message', details: error.message });
  }
});

// Group management endpoints
app.post('/create-group/:deviceId', async (req, res) => {
  const { deviceId } = req.params;
  const { groupName, participants } = req.body;

  if (!devices[deviceId]) return res.status(400).send({ error: 'Device not connected' });

  try {
    const response = await devices[deviceId].groupCreate(groupName, participants.map(num => `${num}@s.whatsapp.net`));
    res.send({ success: true, groupId: response.id });
  } catch (error) {
    res.status(500).send({ error: 'Failed to create group', details: error.message });
  }
});

app.post('/add-group-participant/:deviceId', async (req, res) => {
  const { deviceId } = req.params;
  const { groupId, participants } = req.body;

  try {
    await devices[deviceId].groupParticipantsUpdate(groupId, participants.map(num => `${num}@s.whatsapp.net`), 'add');
    res.send({ success: true, message: 'Participants added' });
  } catch (error) {
    res.status(500).send({ error: 'Failed to add participants', details: error.message });
  }
});

app.post('/remove-group-participant/:deviceId', async (req, res) => {
  const { deviceId } = req.params;
  const { groupId, participants } = req.body;

  try {
    await devices[deviceId].groupParticipantsUpdate(groupId, participants.map(num => `${num}@s.whatsapp.net`), 'remove');
    res.send({ success: true, message: 'Participants removed' });
  } catch (error) {
    res.status(500).send({ error: 'Failed to remove participants', details: error.message });
  }
});

app.get('/group-info/:deviceId/:groupId', async (req, res) => {
  const { deviceId, groupId } = req.params;

  try {
    const groupMetadata = await devices[deviceId].groupMetadata(groupId);
    res.send({ success: true, groupMetadata });
  } catch (error) {
    res.status(500).send({ error: 'Failed to fetch group info', details: error.message });
  }
});

app.post('/leave-group/:deviceId', async (req, res) => {
  const { deviceId } = req.params;
  const { groupId } = req.body;

  try {
    await devices[deviceId].groupLeave(groupId);
    res.send({ success: true, message: 'Left the group' });
  } catch (error) {
    res.status(500).send({ error: 'Failed to leave group', details: error.message });
  }
});

// Get list of groups
app.get('/list-groups/:deviceId', async (req, res) => {
  const { deviceId } = req.params;
  
  if (!devices[deviceId]) return res.status(400).send({ error: 'Device not connected' });

  try {
    const groups = await devices[deviceId].groupFetchAllParticipating();
    res.send({ success: true, groups });
  } catch (error) {
    res.status(500).send({ error: 'Failed to fetch group list', details: error.message });
  }
});



app.get('/getall/chat/:deviceId', async (req, res) => {
  const { deviceId } = req.params;

  if (!devices[deviceId]) return res.status(400).send({ error: 'Device not connected' });

  try {
    const chats = await devices[deviceId].chatFetchAll();
    res.send({ success: true, chats });
  } catch (error) {
    res.status(500).send({ error: 'Failed to fetch chats', details: error.message });
  }
});

app.listen(port, () => {
  console.log(`WhatsApp Gateway listening on port ${port}`);
});
