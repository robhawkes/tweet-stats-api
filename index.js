var _ = require("underscore");
var Twit = require("twit");

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
  };
}

var silent = false;

var keywords = [];
var technologyStats = {};

var log = function() {
  if(!silent) console.log.apply(console, arguments);
};

var subscribe = function(channel) {
  // Only subscribe if not already done so
  var keywordIndex = keywords.indexOf(channel);
  if(keywordIndex >= 0) return;

  keywords.push(channel);

  // restart with new keyword
  restartStream();

  // start recording stats for new keyword
  // after stopping stream - just in case
  trackStat(channel);
};

var unsubscribe = function(channel) {
  // Only unsubscribe if actually subscribed
  var keywordIndex = keywords.indexOf(channel);
  if(keywordIndex < 0) return;

  keywords.splice(keywordIndex, 1);

  // restart with without the removed keyword
  restartStream();

  // stop recording stats for removed keyword
  // after stopping stream - just in case
  untrackStat(channel);
};

// Capture uncaught errors
process.on("uncaughtException", function(err) {
  console.log(err);

  log("Attempting to restart stream");
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

app.get("/filters", function(req, res) {
  res.json(keywords);
});

app.post("/webhook", function(req,res) {
  var event = req.body.events[ 0 ];
  log("webhook received: %s %s", event.channel, event.name);

  if(event.name === "channel_vacated") {
    unsubscribe(event.channel);
  }
  else if(event.name === "channel_occupied") {
    subscribe(event.channel);
  }
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

  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");

  res.json(output);
});

// Get stats for past 24 hours - Geckoboard formatting
app.get("/stats/:tech/24hours-geckoboard.json", function(req, res, next) {
  if (!technologyStats[req.params.tech]) {
    res.status(404).end();
    return;
  }

  var statsCopy = JSON.parse(JSON.stringify(technologyStats[req.params.tech].past24.data)).reverse();

  var numbers = [];

  _.each(statsCopy, function(stat) {
    numbers.push(stat.value);
  });

  var output = {
    item: [
      {
        text: "Past 24 hours",
        value: technologyStats[req.params.tech].past24.total
      },
      numbers
    ]
  };

  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");

  res.json(output);
});

// Simple logger
app.use(function(req, res, next){
  log("%s %s", req.method, req.url);
  log(req.body);
  next();
});

// Error handler
app.use(errorHandler({
  dumpExceptions: true,
  showStack: true
}));

// Open server on specified port
log("Starting Express server");
var port = process.env.PORT || 5001;
app.listen(port, function() {
  console.log('express listening on port %d', port);
});


// --------------------------------------------------------------------
// STATS UPDATES
// --------------------------------------------------------------------

var statsTime = new Date();

var trackStat = function(tech) {
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
    };
  }
};

var untrackStat = function(tech) {
  if (technologyStats[tech]) {
    delete technologyStats[tech];
  }
};

// Populate initial statistics for each technology
_.each(keywords, function(tech) {
  trackStat(tech);
});

var updateStats = function() {
  var currentTime = new Date();

  if (statsTime.getMinutes() == currentTime.getMinutes()) {
    setTimeout(function() {
      updateStats();
    }, 1000);

    return;
  }

  _.each(keywords, function(tech) {
    var payload = {
      time: statsTime.getTime(),
      value: technologyStats[tech].past24.data[0].value
    };

    log("Sending previous minute via Pusher for %s", tech);
    log(payload);

    // Send stats update via Pusher
    pusher.trigger(tech, "update", payload);

    // Add new minute with a count of 0
    technologyStats[tech].past24.data.unshift({
      value: 0,
      time: currentTime.getTime()
    });

    // Crop array to last 24 hours
    if (technologyStats[tech].past24.data.length > 1440) {
      log("Cropping stats array for past 24 hours");

      // Crop
      var removed = technologyStats[tech].past24.data.splice(1439);

      // Update total
      _.each(removed, function(value) {
        technologyStats[tech].past24.total -= value;
      });
    }
  });

  statsTime = currentTime;

  setTimeout(function() {
    updateStats();
  }, 1000);
};

updateStats();


// --------------------------------------------------------------------
// SET UP TWITTER
// --------------------------------------------------------------------

var twit = new Twit({
  consumer_key: config.twitter_consumer_key,
  consumer_secret: config.twitter_consumer_secret,
  access_token: config.twitter_access_token_key,
  access_token_secret: config.twitter_access_token_secret
});

var twitterStream;
var streamRetryCount = 0;
var streamRetryLimit = 10;
var streamRetryDelay = 1000;

var startStream = function() {
  if(!keywords.length) {
    log("No keywords to track. Not starting Twitter stream");
    return;
  }

  twitterStream = twit.stream("statuses/filter", {
    track: keywords
  });

  twitterStream.on("tweet", function(data) {
    if (streamRetryCount > 0) {
      streamRetryCount = 0;
    }

    processTweet(data);
  });

  twitterStream.on("disconnect", function(message) {
    console.log("Error");
    console.log(message);

    // restartStream();
    // TODO: what if we're the one who has triggered the disconnect
  });
};

var restartStream = function() {
  log("Aborting previous stream");
  if (twitterStream) {
    twitterStream.stop();
  }

  streamRetryCount += 1;

  if (streamRetryCount >= streamRetryLimit) {
    log("Aborting stream retry after too many attempts");
    return;
  }

  setTimeout(startStream, streamRetryDelay * (streamRetryCount * 2));
};

var processTweet = function(tweet) {
  // Look for keywords within text
  _.each(keywords, function(keyword) {
    if (tweet.text.toLowerCase().indexOf(keyword.toLowerCase()) > -1) {
      log("A tweet about " + keyword);

      // Update stats
      technologyStats[keyword].past24.data[0].value += 1;
      technologyStats[keyword].past24.total += 1;
    }
  });
};

startStream();
