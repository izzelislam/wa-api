const { connectDevice, devices, qrCodes } = require('../lib/whatsapp');
const QRCode = require('qrcode');
const { Boom } = require('@hapi/boom');
const generateQr = async (req, res) => {
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
}


const sendMessage = async (req, res) => {
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
}

const getConnectedDevices = (req, res) => {
    res.send({ connectedDevices: Object.keys(devices) });
}

const reconnectDevice = async (req, res) => {
    const { deviceId } = req.params;

    if (devices[deviceId]) {
        devices[deviceId].end();
        delete devices[deviceId];
    }

    await connectDevice(deviceId);
    res.send({ message: `Reconnecting device ${deviceId}...` });
}

const sendMessageMedia = async (req, res) => {
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
}

const createGroub = async (req, res) => {
    const { deviceId } = req.params;
    const { groupName, participants } = req.body;

    if (!devices[deviceId]) return res.status(400).send({ error: 'Device not connected' });

    try {
        const response = await devices[deviceId].groupCreate(groupName, participants.map(num => `${num}@s.whatsapp.net`));
        res.send({ success: true, groupId: response.id });
    } catch (error) {
        res.status(500).send({ error: 'Failed to create group', details: error.message });
    }
}

const addGroubParticipant = async (req, res) => {
    const { deviceId } = req.params;
    const { groupId, participants } = req.body;

    try {
        await devices[deviceId].groupParticipantsUpdate(groupId, participants.map(num => `${num}@s.whatsapp.net`), 'add');
        res.send({ success: true, message: 'Participants added' });
    } catch (error) {
        res.status(500).send({ error: 'Failed to add participants', details: error.message });
    }
}

const removeGroubParticipant = async (req, res) => {
    const { deviceId } = req.params;
    const { groupId, participants } = req.body;

    try {
        await devices[deviceId].groupParticipantsUpdate(groupId, participants.map(num => `${num}@s.whatsapp.net`), 'remove');
        res.send({ success: true, message: 'Participants removed' });
    } catch (error) {
        res.status(500).send({ error: 'Failed to remove participants', details: error.message });
    }
}

const groubDetail = async (req, res) => {
    const { deviceId, groupId } = req.params;

    try {
        const groupMetadata = await devices[deviceId].groupMetadata(groupId);
        res.send({ success: true, groupMetadata });
    } catch (error) {
        res.status(500).send({ error: 'Failed to fetch group info', details: error.message });
    }
}

const leaveGroub = async (req, res) => {
    const { deviceId } = req.params;
    const { groupId } = req.body;

    try {
        await devices[deviceId].groupLeave(groupId);
        res.send({ success: true, message: 'Left the group' });
    } catch (error) {
        res.status(500).send({ error: 'Failed to leave group', details: error.message });
    }
}

module.exports = {
    generateQr,
    sendMessage,
    getConnectedDevices,
    reconnectDevice,
    sendMessageMedia,
    createGroub,
    addGroubParticipant,
    removeGroubParticipant,
    groubDetail,
    leaveGroub,
};