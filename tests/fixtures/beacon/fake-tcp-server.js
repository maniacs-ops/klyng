var ipc = require('node-ipc');
var crypto = require('crypto');

ipc.config.silent = true;

ipc.serveNet('127.0.0.1', 4895, function() {

    ipc.server.on('PROBE:MSG', function(data, socket) {
        ipc.server.emit(socket, "ALIVE:MSG", {});
    });

    ipc.server.on('MONITOR:MSG', function(msg, socket) {
        console.log(msg.data.line);
        socket.destroy();
        ipc.server.stop();
    });

    ipc.server.on('KLYNG:MSG', function(msg, socket) {
        console.log(msg.data);
        socket.destroy();
        ipc.server.stop();
    });

    ipc.server.on('KEY-EXT:PARAMS', function(data, socket) {
        var dhObj = crypto.createDiffieHellman(data.prime, 'base64');
        var publicKey = dhObj.generateKeys('base64');

        var sharedSecret = dhObj.computeSecret(data.key, 'base64', 'base64');

        console.log(sharedSecret);

        ipc.server.emit(socket, 'KEY-EXT:PUBLIC', {key: publicKey});
    })
});

ipc.server.start();
