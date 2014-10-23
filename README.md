# Tweet Stats

Realtime statistics on Twitter keywords

Demo: [http://tweet-stats.herokuapp.com](http://tweet-stats.herokuapp.com/)

[![](http://cl.ly/image/3G0C1e3I2y43/tweet-stats.jpg)](http://tweet-stats.herokuapp.com/)


## Getting up and running

1. [Create a free Pusher account](http://pusher.com/signup)
2. [Create a Twitter application](https://apps.twitter.com/)
3. Generate access tokens on the "Keys and Access Tokens" tab
4. Create a copy of `config.example.js` and name it `config.js`
5. Fill the configuation options with the values from Pusher and Twitter
6. Add the keywords you want to track as an array of strings in `config.js`
7. Install the dependencies by running `npm install`
8. Test the API locally by running `node index.js` and [checking an API endpoint](http://localhost:5001/keywords.json)
9. Upload the API somewhere public (this is already set up for [Heroku](http://heroku.com))
10. [Set up the demo](https://github.com/robhawkes/tweet-stats-demo)