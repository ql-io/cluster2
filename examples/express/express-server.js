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
    express = require('express');

//
// An express server cluster

var serving = true;
var app = express.createServer();
app.get('/', function(req, res) {
    res.send('hello');
    if(!serving)  {
        req.connection.end();
    }
});

app.on('close', function() {
    serving = false;
})

var c = new Cluster({
    port: 3000,
    cluster: true,
    timeout: 500,
    ecv: {
        path: '/ecv', // Send GET to this for a heartbeat
        control: true, // send POST to /ecv/disable to disable the heartbeat, and to /ecv/enable to enable again
        monitor: '/',
        validator: function() {
            return true;
        }
    }
});

c.on('died', function(pid) {
    console.log('Worker ' + pid + ' died');
});
c.on('forked', function(pid) {
    console.log('Worker ' + pid + ' forked');
});

c.listen(function(cb) {
    cb(app);
});
