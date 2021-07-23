process.env.NODE_ENV = 'test'

var test = require('ava')
var map = require('map-limit')
var servertest = require('servertest')
var server = require('../lib/server')

var targets = [
  {
    id: 1,
    url: 'http://example-1.com',
    value: 0.50,
    maxAcceptsPerDay: 10,
    accept: {
      geoState: ['ca', 'ny'],
      hour: [13, 14, 15]
    }
  },
  {
    id: 2,
    url: 'http://example-2.com',
    value: 1.50,
    maxAcceptsPerDay: 2,
    accept: {
      geoState: ['ca'],
      hour: [14, 15]
    }
  }
]

test.serial.cb('healthcheck', function (t) {
  var url = '/health'
  servertest(server(), url, { encoding: 'json' }, function (err, res) {
    t.falsy(err, 'no error')

    t.is(res.statusCode, 200, 'correct statusCode')
    t.is(res.body.status, 'OK', 'status is ok')
    t.end()
  })
})

test.serial.cb('add targets', t => {
  map(targets, 1, addTarget, function (err) {
    t.falsy(err, 'should not error')
    t.end()
  })

  function addTarget (target, cb) {
    var opts = { encoding: 'json', method: 'POST' }
    var req = servertest(server(), '/api/targets', opts, function (err, res) {
      t.is(res.statusCode, 201, 'correct statusCode')
      cb(err)
    })

    req.end(JSON.stringify(target))
  }
})

test.serial.cb('return all targets', t => {
  servertest(server(), '/api/targets', { encoding: 'json' }, function (err, res) {
    t.falsy(err, 'no error')
    t.is(res.statusCode, 200, 'correct statusCode')
    t.deepEqual(res.body, targets, 'target should match')
    t.end()
  })
})

test.serial.cb('get individual targets', t => {
  map(targets, 1, getTarget, function (err) {
    t.falsy(err, 'should not error')
    t.end()
  })

  function getTarget (target, cb) {
    var opts = { encoding: 'json' }
    servertest(server(), '/api/target/' + target.id, opts, function (err, res) {
      if (err) return cb(err)
      t.is(res.statusCode, 200, 'correct statusCode')
      t.deepEqual(res.body, target, 'target should match')
      cb()
    })
  }
})

test.serial.cb('should receive decisions', t => {
  var visits = [
    { timestamp: '2021-07-22T13:30:00.000Z', geoState: 'ny', publisher: 'aaa' },
    { timestamp: '2021-07-22T14:30:00.000Z', geoState: 'ca', publisher: 'bbb' },
    { timestamp: '2021-07-22T15:30:00.000Z', geoState: 'ca', publisher: 'ccc' }
  ]

  var expected = [
    'http://example-1.com',
    'http://example-2.com',
    'http://example-2.com'
  ]

  map(visits, 1, routeTraffic, function (err, decisions) {
    t.falsy(err, 'should not error')
    t.deepEqual(decisions, expected, 'decisions should match')
    t.end()
  })

  function routeTraffic (visit, cb) {
    var opts = { encoding: 'json', method: 'POST' }
    var req = servertest(server(), '/route', opts, function (err, res) {
      if (err) return cb(err)
      cb(null, res.body.decision)
    })

    req.end(JSON.stringify(visit))
  }
})
