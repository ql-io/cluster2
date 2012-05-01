
## What is cluster2

![Travis status](https://secure.travis-ci.org/ql-io/cluster2.png)

cluster2 is a node.js (>= 0.6.x) compatible multi-process management module. This module grew out of
our needs in operationalizing node.js for [ql.io](https://github.com/ql-io/ql.io) at eBay. Built on
node's `cluster`, cluster2 adds several safeguards and utility functions for real-world production
scenarios:

* Scriptable start, shutdown and stop flows
* Worker monitoring for process deaths
* Worker recycling
* Graceful shutdown
* Idle timeouts
* Validation hooks (for other tools to monitor cluster2 apps)
* Events for logging cluster activities

## Usage

### Getting cluster2

    npm install cluster2

### Start a TCP Server

    var Cluster = require('cluster2'),
        net = require('net');
    var server = net.createServer(function (c) {
        c.on('end', function () {
            console.log('server disconnected');
        });
        c.write('hello\r\n');
        c.pipe(c);
    });

    var c = new Cluster({
        port: 3000,
        cluster: true
    });

### Start a HTTP Server

    var Cluster = require('cluster2'),
        http = require('http');
    var server = http.createServer(function (req, res) {
        res.writeHead(200);
        res.end('hello');
    });
    var c = new Cluster({
        port: 3000
    });
    c.listen(function(cb) {
        cb(server);
    });

### Start an Express Server

    var Cluster = require('cluster2'),
        express = require('express');
    var app = express.createServer();
    app.get('/', function(req, res) {
        res.send('hello');
    });

    var c = new Cluster({
        port: 3000,
    });
    c.listen(function(cb) {
        cb(app);
    });

### Stop a Server

    var Cluster = require('cluster2');
    var c = new Cluster();
    c.stop();

### Gracefully Shutdown a Server

    var Cluster = require('cluster2');
    var c = new Cluster();
    c.shutdown();


## Options

Cluster2 takes the following options.

* `cluster`: When `true` starts a number of workers. Use `false` to start the server as a single
   process. Defaults to `true`.
* `pids`: A directory to write PID files for master and workers.
* `port`: Port number for the app, defaults to `3000`.
* `monPort`: Port number for the monitor URL, defaults to `3001`. Go to `http://<localhost>:3001` to
   view application logs (whatever is written to a `/logs` dir), and npm dependencies.
* `ecv`: A validator to validate the runtime health of the app. If found unhealthy, emits a disable
   traffic signal at path `/ecv`. ECV stands for "extended content verification".
* `noWorkers`: Defaults to `os.cpus().length`.
* `timeout`: Idle socket timeout. Automatically ends incoming sockets if found idle for this
   duration. Defaults to `30` seconds.
* `connThreshold`: When the number of connections processed exceeds this numbers, recycle the worker
   process. This can help recover from slow leaks in your code or dependent modules.

## Graceful Shutdown

The purpose of `shutdown()` is to let the server reject taking new connections, handle all pending
requests and end the connecton so that no request dropped. In order to handling `shutdown()`, the
server must handle `close` events as follows.

    var serving = true;
    var server = http.createServer(function (req, res) {
        if(!serving) {
            // Be nice and send a connection: close as otherwise the client may pump more requests
            // on the same connection
            res.writeHead(200, {
                'connection': 'close'
            });
        }
        res.writeHead(200);
        res.end('hello');
    });
    server.on('close', function() {
        serving = false;
    })
    var c = new Cluster({
        port: 3000,
        cluster: true
    });

Completion of `shutdown()` does not necessarily mean that all worker processes are dead immediately. The workers
may take a while to complete processing of current requests and exit. The `shutdown` flow only
guarantees that the server takes no new connections.

## Cluster2 Events

Cluster2 is an `EventEmitter` and emits the following events.

* `died`: Emitted when a worker dies. This event is also emitted during normal `shutdown()` or
  `stop()`.
* `forked`: Emitted when a new worker is forked.
* `<signal>`: Emitted when a worker receives a signal (such as `SIGKILL`, `SIGTERM` or `SIGINT`).

Here is an example that logs these events to the disk.

    var Cluster = require('cluster2'),
        http = require('http');

    var server = http.createServer(function (req, res) {
        res.writeHead(200);
        res.end('hello');
    });
    var c = new Cluster({
        cluster: true,
        port: 3000
    });
    c.on('died', function(pid) {
        console.log('Worker ' + pid + ' died');
    });
    c.on('forked', function(pid) {
        console.log('Worker ' + pid + ' forked');
    });
    c.on('SIGKILL', function() {
        console.log('Got SIGKILL');
    });
    c.on('SIGTERM', function(event) {
        console.log('Got SIGTERM - shutting down');
    });
    c.on('SIGINT', function() {
        console.log('Got SIGINT');
    });
    c.listen(function(cb) {
        cb(server);
    });

