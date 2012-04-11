* <del>Basic cluster</del>
* <del>St art from js</del>
* <del>Start from command line args</del>
* <del>Add `since` header to report uptime</del>
* <del>`app.close()` during SIGTERM</del>
* Mon
* Check for open port and and exit when busy with an error exit code
* Skip logging when disk is low
* Write start/shutdown/stop to log
* <del>ECV</del>
* Send counters in bulk
* Graceful shutdown - stop connection listening
* Traffic in and out - continue connection listening but update ecv
* Process restart
* Process recycle
* Drain incoming connections on timeout
* Drain incoming connections on shutdown
* Raise heartbeats thru logEmitter https://github.scm.corp.ebay.com/qlio/ql.io/issues/74