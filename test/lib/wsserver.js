/*
 * Copyright 2012 eBay Software Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

var Cluster = require('../../lib/index.js'),
    WebSocketServer = require('websocket').server,
    http = require("http");

var server = http.createServer(function(request, response) {
    console.log((new Date()) + ' Received request for ' + request.url);
    response.writeHead(200);
    response.end();
});

var wsServer = new WebSocketServer({
    httpServer: server,
    // You should not use autoAcceptConnections for production
    // applications, as it defeats all standard cross-origin protection
    // facilities built into the protocol and the browser.  You should
    // *always* verify the connection's origin and decide whether or not
    // to accept it.
    autoAcceptConnections: false
});

function originIsAllowed(origin) {
    // put logic here to detect whether the specified origin is allowed.
    return true;
}

wsServer.on('request', function(request) {
    if (!originIsAllowed(request.origin)) {
        // Make sure we only accept requests from an allowed origin
        request.reject();
        console.log((new Date()) + ' Connection from origin ' + request.origin + ' rejected.');
        return;
    }

    var connection = request.accept('echo-protocol', request.origin);
    console.log((new Date()) + ' Connection accepted.');
    connection.on('message', function(message) {

        if (message.type === 'utf8') {
            console.log('Process:' + process.pid + ' Received Message: ' + message.utf8Data);
            connection.sendUTF(message.utf8Data);
        }
        else if (message.type === 'binary') {
            console.log('Process:' + process.pid + ' Received Binary Message of ' + message.binaryData.length + ' bytes');
            connection.sendBytes(message.binaryData);
        }
    });
    connection.on('close', function(reasonCode, description) {
        console.log((new Date()) + ' Peer ' + connection.remoteAddress + ' disconnected.');

        wsServer.close();
    });
});

server.on('close', function() {
    serving = false;
})

var c = new Cluster({
    timeout: 300 * 1000,
    port: process.env["port"] || 3000,
    monPort: process.env["monPort"] || 10000 - process.env["port"] || 3001,
    cluster: true,
    noWorkers: process.env["noWorkers"] || 2,
    connThreshold: 10,
    ecv: {
        control: true
    },
    heartbeatInterval: 1000
});

c.on('died', function(pid) {
    console.log('Worker ' + pid + ' died');
    process.send({
        dead: true
    })
});

c.on('forked', function(pid) {
    console.log('Worker ' + pid + ' forked');
});

c.on('listening', function(pid){
    console.log('Worker ' + pid + ' listening');
    process.send({
        ready: true
    });
});

c.on('SIGKILL', function() {
    console.log('Got SIGKILL');
    process.send({
        'signal':'SIGKILL'
    });
});

c.on('SIGTERM', function(event) {
    console.log('Got SIGTERM - shutting down');
    console.log(event);
    process.send({
        'signal':'SIGTERM'
    });
});

c.on('SIGINT', function() {
    console.log('Got SIGINT');
    process.send({
        'signal':'SIGINT'
    });
});

c.on('heartbeat', function(heartbeat){

    heartbeat.type = 'heartbeat';
    process.send(heartbeat);
});

c.listen(function(cb) {
    cb(server);
});
