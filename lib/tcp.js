var crypto = require('crypto');
var ipc = require('node-ipc');
var utils = require('./utils');

ipc.config.silent = false;

/*
 * connects to a remote beacon via ip:port
 * @param ip {String}
 * @param port {Number}
 * @return {Promise}: promise of the connection to be made
 */
 function connectTo(ip, port) {
     return new Promise(function(resolve, reject) {
        var id = "sock_" + ip + ":" + port;

        ipc.connectToNet(id, ip, port, function() {

            ipc.of[id].emit("PROBE:MSG", {});

            utils.startTimeout(function() {
                resolve(false);
                ipc.disconnect(id);
            });

            ipc.of[id].on('ALIVE:MSG', function(data) {
                utils.stopTimeout();
                resolve(ipc.of[id]);
            });
        });

     });
 }

 /*
  * disconnects from a remote beacon identified by ip:port
  * @param ip {String}
  * @param port {Number}
  */
  function disconnectFrom(ip, port) {
      var id = "sock_" + ip + ":" + port;
      ipc.disconnect(id);
  }

  /*
   * carries the key exchange process between the communicating nodes
   * @param connection {Socket}: the socket to between the nodes
   * @return {Promise}: a promise of the shared secret
   */
  function exchangeKeyOver(connection) {
      return new Promise(function(resolve, reject) {
          var dhObj = crypto.createDiffieHellman(512);
          var sharedPrime = dhObj.getPrime('base64');
          var publicKey = dhObj.generateKeys('base64');

          connection.emit('KEY-EXT:PARAMS', {prime: sharedPrime, key: publicKey});
          connection.on('KEY-EXT:PUBLIC', function(data) {
              var sharedSecret = dhObj.computeSecret(data.key, 'base64', 'base64');
              resolve({connection: connection, secret: sharedSecret});
          });
      });
  }

  /*
   * authenticates and authorize access to remote node with password
   * @param connection {Socket}: the socket connecting to the remote node
   * @param secret {String}: the encryption seceret key
   * @param passwd {String}: the remote node password
   */
  function authOver(connection, secret, passwd) {
     return new Promise(function(resolve, reject) {
         var cipher = crypto.createCipher('aes-256-ctr', secret);
         var encrypted = '' + cipher.update(passwd, 'utf8', 'base64') + cipher.final('base64');

         connection.emit('AUTH', {payload: encrypted});
         connection.on('AUTH:STATUS', function(data) {
             resolve(data.status);
         });
     });
  }

  module.exports = {
      connectTo: connectTo,
      disconnectFrom: disconnectFrom,
      exchangeKeyOver: exchangeKeyOver,
      authOver: authOver
  };