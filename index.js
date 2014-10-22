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
    pusher_key: process.env.PUSHER_KEY,
    pusher_secret: process.env.PUSHER_SECRET,
    twitter_consumer_key: process.env.TWITTER_CONSUMER_KEY,
    twitter_consumer_secret: process.env.TWITTER_CONSUMER_SECRET,
    twitter_access_token_key: process.env.TWITTER_ACCESS_TOKEN_KEY,
    twitter_access_token_secret: process.env.TWITTER_ACCESS_TOKEN_SECRET
  }
}

var silent = true;

var keywords = ["html5", "javascript", "css", "webgl", "websockets", "nodejs", "node.js"];
var technologyStats = {};

// Capture uncaught errors
process.on("uncaughtException", function(err) {
  console.log(err);

  if (!silent) console.log("Attempting to restart stream");
  restartStream();
});

// --------------------------------------------------------------------
// SET UP PUSHER
// --------------------------------------------------------------------
var Pusher = require("pusher");
var pusher = new Pusher({
  appId: config.pusher_app_id,
  key: config.pusher_key,
  secret: config.pusher_secret
});


// --------------------------------------------------------------------
// SET UP EXPRESS
// --------------------------------------------------------------------

var app = express();

// Parse application/json and application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({
  extended: true
}));
app.use(bodyParser.json());

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
    total: technologyStats[req.params.tech].past24.total,
    data: JSON.parse(JSON.stringify(technologyStats[req.params.tech].past24.data)).reverse()
  };

  res.json(output);
});

// Get stats for past 24 hours - Geckoboard formatting
app.get("/stats/:tech/24hours-geckoboard.json", function(req, res, next) {
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
// STATS UPDATES
// --------------------------------------------------------------------

var statsTime = new Date();

// Populate initial statistics for each technology
_.each(keywords, function(tech) {
  if (!technologyStats[tech]) {
    technologyStats[tech] = {
      past24: {
        total: 0,
        // Per-minute, with anything after 24-hours removed
        data: [{
          value: 0,
          time: statsTime.getTime()
        }]
      }
    }
  }
});

var updateStats = function() {
  var currentTime = new Date();
  
  if (statsTime.getMinutes() == currentTime.getMinutes()) {
    setTimeout(function() {
      updateStats();
    }, 1000);

    return;
  }

  var statsPayload = {};

  _.each(keywords, function(tech) {
    statsPayload[tech] = {
      time: statsTime.getTime(),
      value: technologyStats[tech].past24.data[0].value
    };

    // Add new minute with a count of 0
    technologyStats[tech].past24.data.unshift({
      value: 0,
      time: currentTime.getTime()
    });

    // Crop array to last 24 hours
    if (technologyStats[tech].past24.data.length > 1440) {
      if (!silent) console.log("Cropping stats array for past 24 hours");

      // Crop
      var removed = technologyStats[tech].past24.data.splice(1439);

      // Update total
      _.each(removed, function(value) {
        technologyStats[tech].past24.total -= value;
      });
    }
  });

  if (!silent) console.log("Sending previous minute via Pusher");
  if (!silent) console.log(statsPayload);

  // Send stats update via Pusher
  pusher.trigger("stats", "update", statsPayload);

  statsTime = currentTime;

  setTimeout(function() {
    updateStats();
  }, 1000);
};

updateStats();


// --------------------------------------------------------------------
// SET UP TWITTER
// --------------------------------------------------------------------

var twit = new twitter({
  consumer_key: config.twitter_consumer_key,
  consumer_secret: config.twitter_consumer_secret,
  access_token_key: config.twitter_access_token_key,
  access_token_secret: config.twitter_access_token_secret
});

var twitterStream;
var streamRetryCount = 0;
var streamRetryLimit = 10;
var streamRetryDelay = 1000;

var startStream = function() {
  twit.stream("filter", {
    track: keywords.join(",")
  }, function(stream) {
    twitterStream = stream;

    twitterStream.on("data", function(data) {
      if (streamRetryCount > 0) {
        streamRetryCount = 0;
      }

      processTweet(data);
    });

    twitterStream.on("error", function(error) {
      console.log("Error");
      console.log(error);

      restartStream();
    });

    twitterStream.on("end", function(response) {
      console.log("Stream end");
      restartStream();
    });
  });
};

var restartStream = function() {
  if (!silent) console.log("Aborting previous stream");
  if (twitterStream) {
    twitterStream.destroy();
  }

  streamRetryCount += 1;

  if (streamRetryCount >= streamRetryLimit) {
    if (!silent) console.log("Aborting stream retry after too many attempts");
    return;
  }

  setTimeout(startStream, streamRetryDelay * (streamRetryCount * 2));
};

var processTweet = function(tweet) {
  // Look for keywords within text
  _.each(keywords, function(keyword) {
    if (tweet.text.toLowerCase().indexOf(keyword.toLowerCase()) > -1) {
      if (!silent) console.log("A tweet about " + keyword);

      // Update stats
      technologyStats[keyword].past24.data[0].value += 1;
      technologyStats[keyword].past24.total += 1;
    }
  });
};

startStream();