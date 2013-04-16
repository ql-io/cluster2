## What is cluster2

![Travis status](https://secure.travis-ci.org/ql-io/cluster2.png)

NOTE: For node (<=0.6.x), use cluster2 version 0.3.1

cluster2 is a node.js (>= 0.8.x) compatible multi-process management module. This module grew out of
our needs in operationalizing node.js for [ql.io](https://github.com/ql-io/ql.io) at eBay. Built on
node's `cluster`, cluster2 adds several safeguards and utility functions to help support real-world
production scenarios:

* Scriptable start, shutdown and stop flows
* Worker monitoring for process deaths
* Worker recycling
* Graceful shutdown
* Idle timeouts
* Validation hooks (for other tools to monitor cluster2 apps)
* Events for logging cluster activities
* Exit with error code when the port is busy to fail start scripts
* Disable monitor
* and more coming soon

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
    c.listen(function(cb) {
        cb(server);
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
* `host`: Hostname or IP for the app listening, defaults to `0.0.0.0`.
* `monHost`: Hostname or IP for the monitor listening, defaults to `0.0.0.0`. 
* `monPort`: Port number for the monitor URL, defaults to `3001`. Go to `http://<localhost>:3001` to
   view application logs (whatever is written to a `/logs` dir), and npm dependencies.
* `ecv`: ECV stands for "extended content verification". This is an object with the following
   additional properties:
     * `path`: A path to serve a heart beat. See below.
     * `monitor`: A URI to check before emitting a valid heart beat signal
     * `control`: When true, allows clients to enable or disable the signal. See below.
     validator to validate the runtime health of the app. If found unhealthy, emits a disable
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

Completion of `shutdown()` does not necessarily mean that all worker processes are dead immediately. 
The workers may take a while to complete processing of current requests and exit. The `shutdown()` 
flow only guarantees that the server takes no new connections.

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
        port: 3000,
        host: 'localhost'
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

## Routing Traffic

It is fairly common for proxies or load balancers deployed in front of node clusters, and those
proxies to use monitor URLs to detect the health of the cluster. Cluster2 includes a monitor
at `http://<host>:<port>/ecv`. You can change this by setting the `path` property when initializing
the cluster.

In case you want to take the node cluster out of rotation from the proxy/load balancer, you can do
so by setting `control` to `true` when initializing the cluster. At runtime, you can send a `POST`
request to `http://<host>:<port>/ecv/disable`. Once this is done, further requests to
`http://<host>:<port>/ecv` will get a network error. You can bring the cluster back to rotation by
sending a `POST` request to `http://<host>:<port>/ecv/enable`.

Since it will be potentially disastrous to let artibrary clients enable/disable traffic, you should
configure your proxy/load balancer to prevent external traffic to `/ecv*`.

To test this, bring up an example

    node examples/express/express-server.js

and send a `GET` request to `http://localhost:3000/ecv` and notice the response.

    HTTP/1.1 200 OK
    X-Powered-By: Cluster2
    content-type: text/plain
    since: Fri May 18 2012 09:49:32 GMT-0700 (PDT)
    cache-control: no-cache
    Connection: keep-alive
    Transfer-Encoding: chunked

    status=AVAILABLE&ServeTraffic=true&ip=127.0.0.1&hostname=somehost&port=3000&time=Fri May 18 2012 09:49:49 GMT-0700 (PDT)

To flip the monitor into a disabled state, send a `POST` request to `http://localhost:3000/disable`.

    HTTP/1.1 204 No Content
    X-Powered-By: Cluster2
    since: Fri May 18 2012 09:54:25 GMT-0700 (PDT)
    cache-control: no-cache
    Connection: close

Subsequent `GET` requests to `http://localhost:3000/ecv` will return a response similar to the one
below.

    HTTP/1.1 400 Bad Request
    X-Powered-By: Cluster2
    content-type: text/plain
    since: Fri May 18 2012 09:54:25 GMT-0700 (PDT)
    cache-control: no-cache
    Connection: close
    Transfer-Encoding: chunked

    status=DISABLED&ServeTraffic=false&ip=127.0.0.1&hostname=somehost&port=3000&time=Fri May 18 2012 09:55:17 GMT-0700 (PDT)

To flip the monitor back into an enabled state, send a `POST` request to `http://localhost:3000/enable`.


NOTE for 0.4.0 version
The major change is to support a general work delegation pattern between workers & master. In a few scenarios, we've seen duplicate work
done by each worker, that could be delegated to master to address and avoid the duplication of effort. And to make it general enough, we
defined the following delegation pattern:
worker -> master : message
message.type is "delegate"
message.delegate defines the actual message type
message.expect is optional, if not given, the delegate work is silently handled by master (e.g. logging remotely); if given, worker will expect a response message whose
type must equal message.expect; if given expect, the following will be enabled: message.matches defines the matching criteria of the response message, message.timeout defines
the max timeout of the delegate work. message.notification allows delegated work to publish changes detected later.
message.origin keeps the orginal message.
In cluster2, after master receives the message from worker, it would turn it into an event message, and find the proper listener to handle such.
The event handler could be config reader, remote logger, resource externalizer e.g. and they might/might not respond to master based on the expect.