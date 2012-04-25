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

'use strict'

var Cluster = require('./../lib/index.js'),
    http = require('http'),
    testCase = require('nodeunit').testCase,
    express = require('express');

var hostname = require('os').hostname();

module.exports = testCase({
    'check ecv': function(test) {
        var app = express.createServer();
        app.get('/', function(req, res){
            res.send('hello');
        });

        var cluster = new Cluster({
            port: 3000,
            cluster: false,
            ecv: {
                monitor: '/',
                validator: function () {
                    return true;
                }
            }
        });
        cluster.listen(function(cb) {
                cb(app);
            },
            function (app) {
                setTimeout(function () {
                    // Regex to match the expected response. Tricky part is the IPv4 match.
                    // Very naive exp to check numbers 0 - 255.
                    // (25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]? ) -> ( numbers 250 to 255 | numbers 200 to 249 | numbers 0 to 199)
                    // Same expression for each of the 4 IPs
                    var re = new RegExp('status=AVAILABLE&ServeTraffic=true&ip=(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)&hostname=' + hostname + '&port=3000&time=.*');
                    try {
                        var options = {
                            host: 'localhost',
                            port: 3000,
                            path: '/ecv',
                            method: 'GET'
                        };
                        var request = http.request(options, function (res) {
                            var response = '';
                            res.on('data', function (chunk) {
                                response += chunk;
                            });
                            res.on('end', function () {
                                var result = re.exec(response);
                                test.ok(result !== null,
                                    'expected:status=AVAILABLE&ServeTraffic=true&ip=<Network IP>&hostname=' + hostname + '&port=3000&time=.*');
                                app.close();
                                test.done();
                            });
                        });
                        request.on('error', function (err) {
                            console.log(err.stack || err);
                            console.log('Error with uri - ' + request.uri + ' - ' + err.message);
                        });
                        request.end();
                    }
                    catch(e) {
                        console.log(e);
                        test.ok(false);
                    }
                }, 200);
            }
        );
    }
});

