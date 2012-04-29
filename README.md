
### What is cluster2

![Travis status](https://secure.travis-ci.org/ql-io/cluster2.png)

cluster2 is a node.js (>= 0.6.x) compatible multi-process management module. This module grew out of
our experience in operationalizing node.js for [ql.io](https://github.com/ql-io/ql.io) at eBay.
Built on node's `cluster`, cluster2 provides several several additional capabilities:

* Scriptable start, shutdown and stop
* Worker monitoring for process deaths
* Worker recycling
* Graceful shutdown
* Idle timeouts
* Validation hook (for other tools to monitor cluster2 apps)
* Events for logging cluster activities

```
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
```

### Options

Cluster2 takes the following options.

* `pids`: A directory to write PID files for master and workers.
* `port`: Port number for the app, defaults to `3000`.
* `monPort`: Port number for the monitor URL, defaults to `3001`. Go to `http://<localhost>:3001` to
   view application logs (whatever is written to a `/logs` dir), and npm dependencies.
* `ecv`: A validator to validate the runtime health of the app. If found unhealthy, emits a disable
   traffic signal at path `/ecv`.
* `noWorkers`: Defaults to `os.cpus().length`.
* `timeout`: Idle socket timeout. Automatically ends incoming sockets if found idle for this
   duration. Defaults to `30` seconds.
* `connThreshold`: When the number of connections processed exceeds this numbers, recycle the worker
   process. This can help recover from slow leaks in your code or dependent modules.

### API

#### Start

```
