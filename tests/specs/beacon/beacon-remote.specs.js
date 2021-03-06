var tcp = require('../../../lib/tcp');
var cs = require('../../../lib/crypto-service');
var jobman = require('../../../lib/job-manager');
var router = require('../../../lib/router');
var expect = require('chai').expect;
var spawn = require('child_process').spawn;
var ipc = require('node-ipc');

var configs = require('../../../lib/beacon-configs');

var fake_server;

configs.configureRemoteIPC(ipc);

describe("Beacon Remote Communincation", function() {

    this.timeout(7000);

    before(function() {tcp.start({port: 7777, password: "dummy"});});
    after(function() {
        ipc.disconnect('auth_socket');
        ipc.disconnect('nauth_socket');
        tcp.stop();
    });

    beforeEach(function() {
        if(!!ipc.of.auth_socket) {
            ipc.of.auth_socket.off('AUTH:STATUS');
        }

        if(!!ipc.of.nauth_socket) {
            ipc.of.nauth_socket.off('AUTH:STATUS');
        }
    });

    afterEach(function(done) {
        tcp.disconnectFrom('127.0.0.1', 4895);
        fake_server.kill();
        setTimeout(done, 500);
    });

    it('connects/disconnects to/from a running tcp server', function(done) {

        fake_server= spawn('node', ['./tests/fixtures/beacon/fake-tcp-server.js']);

        tcp.connectTo('127.0.0.1', 4895)
        .then(function(connection) {
            expect(!!connection).to.equal(true);
            expect(connection.socket.destroyed).to.equal(false);
            tcp.disconnectFrom('127.0.0.1', 4895);
            expect(connection.socket.destroyed).to.equal(true);

            done();
        })
        .catch(done);
    });

    it('fails to connect to non-existing tcp server', function(done) {

        tcp.connectTo('127.0.0.1', 4895)
        .then(function(connection) {
            expect(!!connection).to.equal(true);
            done(new Error("This should never happen"));
        })
        .catch(function(err) {
            done();
        });
    });

    it('exchanges a shared secret key with tcp server', function(done) {

        fake_server= spawn('node', ['./tests/fixtures/beacon/fake-tcp-server.js']);
        var fake_server_stdout = "";
        fake_server.stdout.on('data', function(chunck) { fake_server_stdout += chunck.toString().trim(); });

        tcp.connectTo('127.0.0.1', 4895)
        .then(function(connection) {
            return tcp.exchangeKeyOver(connection);
        })
        .then(function(params) {
            expect(params.secret).to.equal(fake_server_stdout);
            done();
        })
        .catch(done);
    });

    it('authorizes access to remote address with correct password', function(done) {

        fake_server= spawn('node', ['./tests/fixtures/beacon/fake-tcp-server.js']);

        var con = null;

        tcp.connectTo('127.0.0.1', 4895)
        .then(function(connection) {
            con = connection;
            return tcp.exchangeKeyOver(connection);
        })
        .then(function(params) {
            return tcp.authOver(params.connection, params.secret, 'a1b2c3d4');
        })
        .then(function(params) {
            done();
        })
        .catch(done);
    });

    it('fails to authorize access to remote address due to wrong password', function(done) {

        fake_server= spawn('node', ['./tests/fixtures/beacon/fake-tcp-server.js']);

        var con = null;

        tcp.connectTo('127.0.0.1', 4895)
        .then(function(connection) {
            con = connection;
            return tcp.exchangeKeyOver(connection);
        })
        .then(function(params) {
            return tcp.authOver(params.connection, params.secret, '12345678');
        })
        .then(function(params) {
            done(new Error("This should never happen"));
        })
        .catch(function(err) {
            expect(err.message).to.equal("127.0.0.1:4895 incorrect password");
            done();
        });
    });

    it('sends a job to a remote beacon', function(done) {
        fake_server= spawn('node', ['./tests/fixtures/beacon/fake-tcp-server.js']);

        tcp.connectTo('127.0.0.1', 4895)
        .then(function(connection) {
            return tcp.exchangeKeyOver(connection);
        })
        .then(function(params) {
            return tcp.authOver(params.connection, params.secret, 'a1b2c3d4');
        })
        .then(function(params) {
            var job = {
                id: 1,
                pckg: 'packed.app',
                size: 11,
            };
            var plan = {
                "local": {count: 5, start: 0},
                "127.0.0.1:4895": {count: 4, start: 5},
                "127.0.0.2:2222": {count: 2, start: 9}
            };

            return tcp.sendJobOver(params.connection, params.secret, job, plan);
        })
        .then(function(sent) {
            if(sent) {
                done();
            }
        })
        .catch(done);
    });

    it('sends a DONE signal to a remote beacon', function(done) {
        fake_server= spawn('node', ['./tests/fixtures/beacon/fake-tcp-server.js']);

        tcp.connectTo('127.0.0.1', 4895)
        .then(function(connection) {
            return tcp.exchangeKeyOver(connection);
        })
        .then(function(params) {
            return tcp.authOver(params.connection, params.secret, 'a1b2c3d4');
        })
        .then(function(params) {
            return tcp.signalDoneOver(params.connection);
        })
        .then(function() {
            done();
        })
        .catch(done);
    })

    it('responds to KEY-EXT:PARAMS and creates a shared secret', function(done) {
        ipc.connectToNet('auth_socket', '127.0.0.1', 7777, function() {
            var dhObj = cs.diffieHellman();
            ipc.of.auth_socket.emit('KEY-EXT:PARAMS', {
                prime: dhObj.prime,
                key: dhObj.publicKey
            });

            ipc.of.auth_socket.on('KEY-EXT:PUBLIC', function(data) {
                ipc.of.auth_socket.klyng_secret = dhObj.computeSecret(data.key);
                var welcomeMsg = cs.verify(data.cipherWelcome, ipc.of.auth_socket.klyng_secret);

                expect(welcomeMsg).to.equal("Hello from Beacon's TCP Server!");
                done();
            })
        });
    });

    it('responds to AUTH message with an incorrect password', function(done) {
        var secret = ipc.of.auth_socket.klyng_secret;
        ipc.of.auth_socket.emit('AUTH', cs.secure({data: "12345"}, secret));
        ipc.of.auth_socket.on('AUTH:STATUS', function(data) {
            expect(data.status).to.be.false;
            expect(data.error).to.equal("incorrect password");
            done();
        });
    });

    it('responds to AUTH message with a correct password', function(done) {
        var secret = ipc.of.auth_socket.klyng_secret;
        ipc.of.auth_socket.emit('AUTH', cs.secure({data: "dummy"}, secret));
        ipc.of.auth_socket.on('AUTH:STATUS', function(data) {
            expect(data.status).to.be.true;
            done();
        });
    });

    it('responds to KLYNG:JOB message and runs the job', function(done) {
        var secret = ipc.of.auth_socket.klyng_secret;
        var job = {
            app: __dirname + '/../../fixtures/beacon/fake_functional_app/main.js',
            size: 2,
            plan: {
                "parent": {port: 9876, start: 0, count: 1},
                "local": {start: 1, count: 1}
            }
        }

        var klyngMsgPromise = new Promise(function(resolve, reject) {
            ipc.serveNet('127.0.0.1', 9876, function() {
                ipc.server.on('KLYNG:MSG', function(msg, socket) {
                    try {
                        expect(msg.header.from).to.equal(1);
                        expect(msg.header.to).to.equal(0);
                        expect(msg.data).to.equal("Weee!");
                        resolve();
                    }
                    catch(err) { reject(err); }
                });
            });
            ipc.server.start();
        });

        var jobAckPromise = jobman.pack(job)
        .then(function(app) {
            return new Promise(function(resolve, reject) {
                job.app = app;
                ipc.of.auth_socket.emit('KLYNG:JOB', cs.secure({data: job}, secret));
                ipc.of.auth_socket.on('JOB:ACK', function(data) {
                    if(!data.status) {
                        reject(new Error(data.error));
                    }
                    else {
                        resolve(true);
                    }
                });
            });
        });

        Promise.all([klyngMsgPromise, jobAckPromise])
        .then(function() { done(); })
        .catch(done);
    });

    it('responds to KLYNG:JOB indicating that the beacon is busy', function(done) {
        ipc.of.auth_socket.emit('KLYNG:JOB', {});
        ipc.of.auth_socket.on('JOB:ACK', function(data) {
            expect(data.status).to.be.false;
            expect(data.error).to.equal("The Beacon is busy");
            done();
        });
    });

    it('responds to SIGNAL:DONE message', function(done) {
        ipc.of.auth_socket.emit('SIGNAL:DONE', {});

        var disconnectPromise = new Promise(function(resolve, reject) {
            ipc.server.on('close', function(socket) {
                resolve();
            });
        });

        var ackPromise = new Promise(function(resolve, reject) {
            ipc.of.auth_socket.on('DONE:ACK', function(data) {
                try {
                    expect(data.status).to.be.true;
                }
                catch(err) { reject(err); }
                ipc.disconnect('auth_socket');
                resolve();
            });
        });

        Promise.all([disconnectPromise, ackPromise])
        .then(function() {
            expect(router.isClean()).to.be.true;
            done();
        })
        .catch(done);
    });

    it('refuses a SIGNAL:DONE message on an unothorized socket', function(done) {
        ipc.connectToNet('nauth_socket', '127.0.0.1', 7777, function() {
            ipc.of.nauth_socket.emit('SIGNAL:DONE');
            ipc.of.nauth_socket.on('DONE:ACK', function(data) {
                expect(data.status).to.be.false;
                expect(data.error).to.equal("Unauthorized");
                done();
            });
        });
    });

    it('refuses a KLYNG:JOB message on an unothorized socket', function(done) {
        ipc.of.nauth_socket.emit('KLYNG:JOB', {});
        ipc.of.nauth_socket.on('JOB:ACK', function(data) {
            expect(data.status).to.be.false;
            expect(data.error).to.equal("Unauthorized");
            done();
        });
    });

    it('refuses an AUTH attempt on an unsecure socket', function(done) {
        ipc.of.nauth_socket.emit('AUTH', {});
        ipc.of.nauth_socket.on('AUTH:STATUS', function(data) {
            expect(data.status).to.be.false;
            expect(data.error).to.equal("unsecure channel");
            done();
        });
    });
});
