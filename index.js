var _ = require("underscore");
var twitter = require("twitter");

var express = require("express");
var bodyParser = require("body-parser");
var errorHandler = require("errorhandler");

var config;
try {
  config = require("./config");
} catch(e) {
  console.log("Failed to find local config, falling back to environment variables");
  config = {
    pusher_app_id: process.env.PUSHER_APP_ID,
    pusher_key: process.env.PUSHER_APP_KEY,
    pusher_secret: process.env.PUSHER_APP_SECRET,
    twitter_consumer_key: process.env.TWITTER_CONSUMER_KEY,
    twitter_consumer_secret: process.env.TWITTER_CONSUMER_SECRET,
    twitter_access_token_key: process.env.TWITTER_ACCESS_TOKEN_KEY,
    twitter_access_token_secret: process.env.TWITTER_ACCESS_TOKEN_SECRET
  }
}

var silent = true;

var keywords = ["html5", "javascript", "css", "webgl", "websockets", "nodejs", "node.js"];
var technologyStats = {};


// --------------------------------------------------------------------
// SET UP PUSHER
// --------------------------------------------------------------------
var Pusher = require("pusher");
var pusher = new Pusher({
  appId: config.app_id,
  key: config.key,
  secret: config.secret
});
pusher.domain = "api-megabus.pusher.com";


// --------------------------------------------------------------------
// SET UP EXPRESS
// --------------------------------------------------------------------

var app = express();

// Parse application/json and application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({
  extended: true
}));
app.use(bodyParser.json());

// Serve static files from directory
// app.use(express.static(root));

// Ping
app.get("/ping", function(req, res) {
  res.status(200).end();
});

// Get stats for past 24 hours
app.get("/stats/:tech/24hours.json", function(req, res, next) {
  if (!technologyStats[req.params.tech]) {
    res.status(404).end();
    return;
  }

  var output = {
    item: [
      {
        text: "Past 24 hours",
        value: technologyStats[req.params.tech].past24.total
      },
      JSON.parse(JSON.stringify(technologyStats[req.params.tech].past24.data)).reverse()
    ]
  };

  res.json(output);
});

// Sentry
// app.use(raven.middleware.express(ravenClient));

// Simple logger
app.use(function(req, res, next){
  if (!silent) console.log("%s %s", req.method, req.url);
  if (!silent) console.log(req.body);
  next();
});

// Error handler
app.use(errorHandler({
  dumpExceptions: true,
  showStack: true
}));

// Open server on specified port
if (!silent) console.log("Starting Express server");
app.listen(process.env.PORT || 5001);


// --------------------------------------------------------------------
// SET UP TWITTER
// --------------------------------------------------------------------

var twit = new twitter({
  consumer_key: config.twitter_consumer_key,
  consumer_secret: config.twitter_consumer_secret,
  access_token_key: config.twitter_access_token_key,
  access_token_secret: config.twitter_access_token_secret
});

twit.stream("filter", {
  track: keywords.join(",")
}, function(stream) {
  stream.on("data", function(data) {
    processTweet(data);
  });

  stream.on("error", function(error) {
    // throw new Error(error);
    // console.log("Error", error);
  });

  stream.on("end", function(response) {
    console.log("Stream end: " + response);
  });

  // Disconnect stream after five seconds
  // setTimeout(stream.destroy, 5000);
});

var processTweet = function(tweet) {
  // Current time for stats
  var statsTime = new Date();

  // Look for keywords within text
  _.each(keywords, function(keyword) {
    if (tweet.text.toLowerCase().indexOf(keyword.toLowerCase()) > -1) {

      if (!silent) console.log("A tweet about " + keyword);

      if (!technologyStats[keyword]) {
        technologyStats[keyword] = {
          past24: {
            total: 0,
            lastTime: null,
            // Per-hour, with anything after 24-hours removed
            data: []
          }
        }
      }

      var count = 1;

      // New minute
      if (!technologyStats[keyword].past24.lastTime || technologyStats[keyword].past24.lastTime.getMinutes() != statsTime.getMinutes()) {
        if (technologyStats[keyword].past24.data.length > 0) {
          // Send previous minute to graphs
          var statsPayload = {
            tech: keyword.toLowerCase(),
            time: technologyStats[keyword].past24.lastTime.getTime(),
            data: technologyStats[keyword].past24.data[0]
          };

          pusher.trigger("stats", "update", statsPayload);
        }

        if (!silent) console.log("Adding to new stats minute");

        technologyStats[keyword].past24.data.unshift(count);
        technologyStats[keyword].past24.total += count;

        // Crop array to last 24 hours
        if (technologyStats[keyword].past24.data.length > 1440) {
          if (!silent) console.log("Cropping stats array for past 24 hours");

          // Crop
          var removed = technologyStats[keyword].past24.data.splice(1439);

          // Update total
          _.each(removed, function(value) {
            technologyStats[keyword].past24.total -= value;
          });
        }

        technologyStats[keyword].past24.lastTime = statsTime;
      } else {
        // Add to most recent minute
        if (!silent) console.log("Adding to existing stats minute");
        technologyStats[keyword].past24.data[0] += count;
        technologyStats[keyword].past24.total += count;
      }
    }
  });
};