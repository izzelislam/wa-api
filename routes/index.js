const express = require('express');
const { generateQr, sendMessage, getConnectedDevices, reconnectDevice, sendMessageMedia, createGroub, addGroubParticipant, removeGroubParticipant, groubDetail, leaveGroub } = require('../controller/WhatsappController');

router = express.Router();

// WhatsApp endpoints
router.get('/qr/:deviceId', generateQr);
router.post('/send-message/:deviceId', sendMessage);
router.get('/devices', getConnectedDevices);
router.get('/reconnect/:deviceId', reconnectDevice);
router.post('/send-button-image/:deviceId', sendMessageMedia);

// Group management endpoints
router.post('/create-group/:deviceId', createGroub);
router.post('/add-group-participant/:deviceId', addGroubParticipant);
router.post('/remove-group-participant/:deviceId', removeGroubParticipant);
router.get('/group-info/:deviceId/:groupId', groubDetail);
router.post('/leave-group/:deviceId', leaveGroub);

module.exports = router;