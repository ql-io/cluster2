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

var Cluster = require('../lib/index.js'),
    http = require('http');

//
// A HTTP server cluster listening on multiple ports.

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
    port: [3000, 3003],
    cluster: true
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
    console.log(event);
});
c.on('SIGINT', function() {
    console.log('Got SIGINT');
});

c.listen(function(cb) {
    cb(server);
});
