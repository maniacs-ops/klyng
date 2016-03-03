var ipc = require('node-ipc');
var router = require('../../../lib/router.js');
var expect = require('chai').expect;
var spawn = require('child_process').spawn;

// FAKE: ipc socket server
ipc.config.silent = true;
ipc.config.id = 'FAKE';
ipc.config.retry = 1500;

describe('Beacon\'s Router', function() {

    before(function() {
        ipc.serve(function(){
            ipc.server.on('message', function(msg) {});
        });
        ipc.server.start();
    });

    after(function() {
        ipc.server.stop();
    });

    it('builds a pure local meta routing table', function() {
        var table = router.buildPureLocalTable(1);
        expect(table.proc0).to.equal('local');
        expect(table.parent).to.equal('local');
    });

    it('routes a message correctly to local parent', function(done) {
        var fake_client = spawn('node', ['./tests/fixtures/beacon/router-ipc-client.js']);
        var fake_client_stdout = "";
        fake_client.stdout.on('data', function(chunck) { fake_client_stdout += chunck.toString().trim(); });

        // wait for a message from the fake client announcing its ipc socket
        ipc.server.on('SOCKET:PUB', function(data, socket) {
            // set the meta table and monitor_socket
            router.setMetaTable(router.buildPureLocalTable(1));
            router.setMonitorSocket(socket);

            router.routeToParent({type: 'process:exit', data: {line: "Hello from router"}});

            fake_client.on('exit', function() {
                expect(fake_client_stdout).to.equal("Hello from router");
                done();
            });
        })
    });

    it('rouets a message correctly to local job instance', function(done) {
        var fake_instance = spawn('node', ['./tests/fixtures/beacon/router-local-process.js'], {stdio: [null, null, null, 'ipc']});
        var fake_instance_stdout = "";
        fake_instance.stdout.on('data', function(chunck) { fake_instance_stdout += chunck.toString().trim() });

        // set the meta table and local channel
        router.setMetaTable(router.buildPureLocalTable(1));
        router.setLocalChannel(0, fake_instance);

        router.routeTo(0, {data: "Hello from router"});

        fake_instance.on('exit', function() {
            expect(fake_instance_stdout).to.equal("Hello from router");
            done();
        });
    });

    it('cleans the router\'s data structures', function() {
        expect(router.isClean()).to.equal(false);
        router.clear();
        expect(router.isClean()).to.equal(true);
    });

});