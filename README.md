# stream-client

Talk to Livefyre/stream-v4

## API

```javascript
var StreamClient = require('stream-client');
var stream = new StreamClient({ environment: 'production' });
stream.on('data', function (d) {
    console.log('got data from stream', d);
});
stream.connect(lftoken, streamId);
```

### Options

* `environment` - qa|uat|production - Which Livefyre environment's stream service you want to connect to.

## `make` commands

* `make build` - will `npm install` and `bower install`
* `make dist` - will use r.js optimizer to compile the source, UMD wrap, and place that and source maps in dist/
* `make clean`
* `make server` - serve the repo over http
* `make deploy [env={*prod,uat,qa}]` - Deploy to lfcdn, optionally specifying a bucket env
