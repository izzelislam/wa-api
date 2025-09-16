// whatsapp-gateway.mjs
import express from 'express'
import Boom from '@hapi/boom'
import makeWASocket, { useMultiFileAuthState } from '@whiskeysockets/baileys'
import mysql from 'mysql2'
import QRCode from 'qrcode'
import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'

// Init
dotenv.config()
const app = express()
const port = process.env.PORT || 3000

// Fix __dirname di ESM
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

app.use(express.json())

// ===================
// Middleware whitelist
// ===================
const whitelistMiddleware = (req, res, next) => {
  const allowedIps = process.env.ALLOWED_IPS ? process.env.ALLOWED_IPS.split(',') : []
  const clientIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress

  if (allowedIps.includes(clientIp)) {
    console.log(`IP ${clientIp} diizinkan mengakses`)
    next()
  } else {
    console.log(`IP ${clientIp} ditolak aksesnya`)
    res.status(403).send({
      error: 'Forbidden: IP not allowed',
      ip: clientIp,
    })
  }
}

// app.use(whitelistMiddleware)

// ===================
// Database (opsional, masih comment seperti di kode lo)
// ===================
// const db = mysql.createPool({
//   connectionLimit: 10,
//   host: process.env.DB_HOST,
//   user: process.env.DB_USER,
//   password: process.env.DB_PASSWORD,
//   database: process.env.DB_NAME
// })

// db.getConnection((err, connection) => {
//   if (err) {
//     console.error('Database connection failed:', err.message)
//     process.exit(1)
//   }
//   console.log('Connected to MySQL database')
//   connection.release()
// })

// db.on('error', (err) => {
//   console.error('MySQL error:', err.message)
// })

// ===================
// State Global
// ===================
let devices = {}
let qrCodes = {}

// ===================
// Utility
// ===================
function deleteSession(deviceId) {
  const sessionPath = path.join(__dirname, 'auth', deviceId)
  if (fs.existsSync(sessionPath)) {
    try {
      fs.rmSync(sessionPath, { recursive: true, force: true })
      console.log(`Session folder ${sessionPath} deleted`)
    } catch (err) {
      console.error('Error deleting session folder:', err)
    }
  } else {
    console.log(`Session folder not found: ${sessionPath}`)
  }
}

// ===================
// Connect Device
// ===================
async function connectDevice(deviceId) {
  try {
    const authFolder = path.join(__dirname, 'auth', deviceId)
    if (!fs.existsSync(authFolder)) {
      fs.mkdirSync(authFolder, { recursive: true })
    }

    const { state, saveCreds } = await useMultiFileAuthState(authFolder)
    const sock = makeWASocket({ auth: state })

    devices[deviceId] = { sock, status: 'connecting' }

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', (update) => {
      const { qr, connection, lastDisconnect } = update

      if (qr) {
        qrCodes[deviceId] = qr
        devices[deviceId].status = 'waiting_for_scan'
      }

      if (connection === 'open') {
        console.log(`Device ${deviceId} connected`)
        delete qrCodes[deviceId]
        devices[deviceId].isConnected = true
        devices[deviceId].status = 'connected'
      }

      if (connection === 'close') {
        console.log(`Device ${deviceId} disconnected`)
        devices[deviceId].status = 'disconnected'
        devices[deviceId].isConnected = false

        if (devices[deviceId]?.sock) {
          devices[deviceId].sock.end()
        }

        if (lastDisconnect?.error) {
          const statusCode = lastDisconnect.error.output?.statusCode
          console.error(`Connection Failure: ${lastDisconnect.error}`)

          if (statusCode === 401) {
            console.log(`Session expired for device ${deviceId}. Deleting session...`)
            deleteSession(deviceId)
          } else {
            console.log(`Reconnecting device ${deviceId} in 5 seconds...`)
            setTimeout(() => connectDevice(deviceId), 5000)
          }
        }

        delete devices[deviceId]
      }
    })

    return sock
  } catch (error) {
    console.error(`Failed to connect device ${deviceId}:`, error)
    return null
  }
}

// Auto-reconnect
function autoReconnectDevices() {
  const authPath = path.join(__dirname, 'auth')
  if (fs.existsSync(authPath)) {
    const deviceIds = fs.readdirSync(authPath)
    deviceIds.forEach((deviceId) => {
      console.log(`Auto-connecting device: ${deviceId}`)
      connectDevice(deviceId)
    })
  }
}
autoReconnectDevices()

// ===================
// Endpoints
// ===================

// Generate QR
app.get('/qr/:deviceId', async (req, res) => {
  const { deviceId } = req.params
  try {
    if (devices[deviceId]?.ws?.readyState === 1) {
      return res.status(400).send({ error: 'Device already connected' })
    }

    if (!devices[deviceId]) {
      await connectDevice(deviceId)
    }

    let attempts = 0
    const maxAttempts = 30

    const waitForQR = setInterval(() => {
      if (qrCodes[deviceId]) {
        clearInterval(waitForQR)
        QRCode.toDataURL(qrCodes[deviceId], (err, url) => {
          if (err) {
            res.status(500).send({ error: 'Error generating QR code' })
          } else {
            res.send({ status: true, message: 'QR generated', data: { deviceId, qrCode: url } })
          }
        })
      } else if (attempts >= maxAttempts) {
        clearInterval(waitForQR)
        res.status(404).send({ status: false, message: 'QR not available or already connected' })
      }
      attempts++
    }, 1000)
  } catch (error) {
    console.error('Failed to initialize device:', error)
    res.status(500).send({ status: false, message: 'Kesalahan server internal', data: error.message })
  }
})

// Send message
app.post('/send-message/:deviceId', async (req, res) => {
  const { deviceId } = req.params
  const { number, message } = req.body

  if (!devices[deviceId]?.sock || !devices[deviceId].isConnected) {
    return res.status(400).send({ error: 'Device not connected' })
  }

  try {
    await devices[deviceId].sock.sendMessage(`${number}@s.whatsapp.net`, { text: message })
    res.send({ success: true, message: 'Message sent successfully' })
  } catch (error) {
    res.status(500).send({ error: 'Failed to send message', details: error.message })
  }
})

// List chats
app.get('/list-chats/:deviceId', async (req, res) => {
  const { deviceId } = req.params
  if (!devices[deviceId]) return res.status(400).send({ error: 'Device not connected' })

  try {
    const chats = await devices[deviceId].chatFetchAll()
    res.send({ success: true, chats })
  } catch (error) {
    res.status(500).send({ error: 'Failed to fetch chats', details: error.message })
  }
})

// List connected devices
app.get('/devices', (req, res) => {
  const connectedDevices = Object.keys(devices).map((deviceId) => ({
    deviceId,
    status: devices[deviceId]?.status || 'disconnected',
  }))
  res.send({ connectedDevices })
})

// ... (semua endpoint group, reconnect, disconnect, dsb tetap sama persis dengan kode lo, cuma diganti ke ESM style)

app.listen(port, () => {
  console.log(`WhatsApp Gateway listening on port ${port}`)
})
