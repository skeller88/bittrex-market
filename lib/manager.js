const _ = require('lodash')
const Market = require('./market')
const signalr = require('signalr-client')
const EventEmitter = require('events')

const wsURI = 'wss://socket.bittrex.com/signalr'
const reconnectWaitTime = 100 //reconnect wait time in ms


class MarketManager extends EventEmitter {
    constructor(replayHistory = false) {
        super()
        this._markets = {}
        this._replayHistory = replayHistory
    }

    connect() {
        this.signalrClient = new signalr.client(wsURI, ['CoreHub'], reconnectWaitTime / 1000)

        this.signalrClient.serviceHandlers.reconnected = (websocket) => {
            _.each(this._markets, (market, currencyPair) => {
                _subscribePair(currencyPair)
            })
        }

        this.signalrClient.serviceHandlers.connected = (websocket) => {
            this.emit('connected')
        }

        this.signalrClient.on('CoreHub', 'updateExchangeState', (message) => {
            this._markets[message.MarketName]._processDeltaMessage(message)
        })
    }

    disconnect() {
        this.signalrClient.end()
    }

    reset() {
        this.disconnect()
        this._markets = {}
        this.connect()
    }

    market(currencyPair) {
        if(!(currencyPair in this._markets)) {
            this._markets[currencyPair] = new Market(currencyPair, this, this._replayHistory)
            this._subscribePair(currencyPair)
        }

        return this._markets[currencyPair]
    }

    _subscribePair(currencyPair) {
        this._markets[currencyPair]._initialized = false //make sure deltas get queued until the initial state is fetched
        this.signalrClient
        .call('CoreHub', 'SubscribeToExchangeDeltas', currencyPair)
        .done((err, result) => {
            if(err) throw err
            if(!result) throw 'Failed to subscribe to currency pair deltas'

            this.signalrClient
            .call('CoreHub', 'QueryExchangeState', currencyPair)
            .done((err, result) => {
                if(err) throw err
                if(!result) throw 'Failed to subscribe to currency pair exchange state'
                this._markets[currencyPair]._initialize(result)
            })
        })
    }
}

module.exports = MarketManager