const _ = require('lodash')
const Market = require('./market')
const signalr = require('signalr-client')
const EventEmitter = require('events')

const wsURI = 'wss://socket.bittrex.com/signalr'
const reconnectWaitTime = 100 //reconnect wait time in ms
const maxCurrenciesPerClient = 20


class MarketManager extends EventEmitter {
    constructor(replayHistory = false) {
        super()
        this._markets = {}
        this._replayHistory = replayHistory
        this._clientPool = []
        this._subscribedCount = 0
        this._currentClient = null
        this._subscriptionQueue = []
        this._subscribing = false
    }

    _addClient(callback) {
        if(this._subscribedCount != 1 && this._subscribedCount % (maxCurrenciesPerClient + 1) != 0) {
            return callback(this._currentClient)
        }

        const client = new signalr.client(wsURI, ['CoreHub'], reconnectWaitTime / 1000)
        client.wasConnected = false

        client.currencyPairs = []

        client.serviceHandlers.reconnected = (websocket) => {
            _.each(client.currencyPairs, (currencyPair) => {
                this._subscribePair(currencyPair, client)
            })
        }

        client.serviceHandlers.connected = (websocket) => {
            if(!client.wasConnected) {
                client.wasConnected = true
                callback(client)
            }
            else {
                client.serviceHandlers.reconnected(websocket)
            }
        }

        client.serviceHandlers.disconnected = (websocket) => {
            setImmediate(() => {
                client.start()
            })
        }

        client.on('CoreHub', 'updateExchangeState', (message) => {
            this._markets[message.MarketName]._processDeltaMessage(message)
        })

        this._clientPool.push(client)
        this._currentClient = client
    }

    reset() {
        _.each(this._clientPool, (client) => {
            client.end()
        })

        this._clientPool = []
        this._currentClient = null
        this._markets = {}
        this._subscribedCount = 0
    }

    market(currencyPair, callback) {
        if(!(currencyPair in this._markets)) {
            this._subscribedCount++
            this._markets[currencyPair] = new Market(currencyPair, this, this._replayHistory)
            this._addClient((client) => {
                return this._subscribePair(currencyPair, client, callback)
            })
        }
        else {
            callback(this._markets[currencyPair])
        }
    }

    _subscribePair(currencyPair, client, callback) {
        if(this._subscribing || !client.wasConnected) {
            this._subscriptionQueue.push([currencyPair, client, callback])
            return
        }
        else {
            this._subscribing = true
        }

        this._markets[currencyPair]._initialized = false //make sure deltas get queued until the initial state is fetched
        client
        .call('CoreHub', 'SubscribeToExchangeDeltas', currencyPair)
        .done((err, result) => {
            if(err) throw err
            if(!result) throw 'Failed to subscribe to currency pair deltas'

            client
            .call('CoreHub', 'QueryExchangeState', currencyPair)
            .done((err, result) => {
                if(err) {
                    delete this._markets[currencyPair]
                    return callback(err, null)
                }
                if(!result) {
                    delete this._markets[currencyPair]
                    return callback('Failed to subscribe to currency pair exchange state', null)
                }
                this._markets[currencyPair]._initialize(result)
                client.currencyPairs.push(currencyPair)
                if(callback) { callback(null, this._markets[currencyPair]) }

                this._subscribing = false

                if(this._subscriptionQueue.length > 0) {
                    const pairToSubscribe = this._subscriptionQueue.shift()
                    return this._subscribePair(pairToSubscribe[0], pairToSubscribe[1],  pairToSubscribe[2])
                }
            })
        })
    }
}

module.exports = MarketManager