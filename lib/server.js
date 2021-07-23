var URL = require('url')
var http = require('http')
var cuid = require('cuid')
var Corsify = require('corsify')
var sendJson = require('send-data/json')
var ReqLogger = require('req-logger')
var healthPoint = require('healthpoint')
var HttpHashRouter = require('http-hash-router')
var async = require('async')

var redis = require('./redis')
var version = require('../package.json').version

var router = HttpHashRouter()
var logger = ReqLogger({ version: version })
var health = healthPoint({ version: version }, redis.healthCheck)
var cors = Corsify({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, accept, content-type'
})

const targetsKey = 'target-'

router.set('/favicon.ico', empty)

router.set('/api/targets', {
  GET: (req, res) => {
    redis.keys(targetsKey + '*', (err, keys) => {
      if (err) return console.log(err)

      if (keys) {
        async.map(keys, (key, cb) => {
          redis.get(key, (error, value) => {
            if (error) return cb(error)
            cb(null, JSON.parse(value))
          })
        }, (error, results) => {
          if (error) return console.log(error)
          res.statusCode = 200
          res.end(JSON.stringify(results))
        })
      }
    })
  },
  POST: (req, res) => {
    var jsonString = ''

    req.on('data', (data) => {
      jsonString += data
    })

    req.on('end', () => {
      const target = JSON.parse(jsonString)
      redis.set(targetsKey + target.id, jsonString)
    })

    res.statusCode = 201
    res.end(JSON.stringify({ status: 'ok' }))
  }
})

router.set('/api/target/:id', (req, res, opts) => {
  redis.get(targetsKey + opts.params.id, (err, obj) => {
    if (err) {
      res.end(JSON.stringify(err))
    } else {
      res.statusCode = 200
      res.end(obj)
    }
  })
})

router.set('/route', {
  POST: (req, res) => {
    var jsonString = ''
    var target = null
    var decision = 'reject'
    var tempVal = -Infinity

    req.on('data', (data) => {
      jsonString += data
    })

    req.on('end', () => {
      const visitor = JSON.parse(jsonString)

      redis.keys(targetsKey + '*', (err, keys) => {
        if (err) return console.log(err)

        if (keys) {
          async.map(keys, (key, cb) => {
            redis.get(key, (error, value) => {
              if (error) return cb(error)
              cb(null, JSON.parse(value))
            })
          }, (error, results) => {
            if (error) return console.log(error)

            results.forEach(t => {
              if (t.maxAcceptsPerDay > 0 &&
                t.accept.geoState.includes(visitor.geoState) &&
                t.accept.hour.includes(new Date(visitor.timestamp).getUTCHours()) &&
                +t.value > tempVal
              ) {
                tempVal = +t.value
                decision = t.url
                target = t
              }
            })

            if (target) {
              target.maxAcceptsPerDay -= 1
              redis.set(targetsKey + target.id, JSON.stringify(target))
            }

            res.end(JSON.stringify({ decision: decision }))
          })
        }
      })
    })
  }
})

module.exports = function createServer () {
  return http.createServer(cors(handler))
}

function handler (req, res) {
  if (req.url === '/health') return health(req, res)
  req.id = cuid()
  logger(req, res, { requestId: req.id }, function (info) {
    info.authEmail = (req.auth || {}).email
    console.log(info)
  })
  router(req, res, { query: getQuery(req.url) }, onError.bind(null, req, res))
}

function onError (req, res, err) {
  if (!err) return

  res.statusCode = err.statusCode || 500
  logError(req, res, err)

  sendJson(req, res, {
    error: err.message || http.STATUS_CODES[res.statusCode]
  })
}

function logError (req, res, err) {
  if (process.env.NODE_ENV === 'test') return

  var logType = res.statusCode >= 500 ? 'error' : 'warn'

  console[logType]({
    err: err,
    requestId: req.id,
    statusCode: res.statusCode
  }, err.message)
}

function empty (req, res) {
  res.writeHead(204)
  res.end()
}

function getQuery (url) {
  return URL.parse(url, true).query // eslint-disable-line
}
