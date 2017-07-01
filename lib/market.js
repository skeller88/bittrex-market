const EventEmitter = require('events')
const _ = require('lodash')
const moment = require('moment')
const assert = require('assert')

class Market extends EventEmitter {
    constructor(currencyPair, manager) {
        super()
        this.currencyPair = currencyPair
        this.ready = false
        this._initialized = false
        this._bids = []
        this._asks = []
        this._deltaQueue = []
        this._lastFillTime = null
    }

    get bids() {
        return this._bids
    }

    get asks() {
        return this._asks
    }

    _initialize(marketState) {
        //set initial state
        this._updateOrderbook(marketState)

        //enable updates to be processed directly
        this._initialized = true

        //apply queued updates on top
        _.each(this._deltaQueue, (deltaMessage) => {
            if(deltaMessage.Nounce >= marketState.Nounce) {
                this._processDeltaMessage(deltaMessage)
            }
        })

        //clear delta queue
        this._deltaQueue = []

        //check if we've already received fill messages
        //this indicates a reconnect. In this case we want to replay all missed fills after this timestamp
        if(this._lastFillTime != null) {
            const missedFills = []
            _.each(marketState.Fills, (fill) => {
                const fillTime = moment.utc(fill.TimeStamp)
                if(fillTime > _lastFillTime) {
                    //transfrom message to conform to the same format
                    missedFills.push({
                        'orderType': fill.OrderType,
                        'quantity': fill.Quantity,
                        'rate': fill.Price,
                        'dateTime': fillTime
                    })
                }
            })

            if(missedFills.length > 0) {
                this._publishFills(missedFills)
            }
        }

        if(!this.ready) {
            this.ready = true
            this.emit('ready')
        }
    }

    _publishFills(fills) {
        if(fills.length > 0) {
            this._lastFillTime = moment.utc(fills[fills.length - 1].TimeStamp)
            this.emit('fills', _.map(fills, (fill) => {
                return {
                    'orderType': fill.OrderType,
                    'quanitity': fill.Quantity,
                    'rate': fill.Rate,
                    'dateTime': moment.utc(fill.TimeStamp)
                }
            }))
        }
    }

    _updateOrderbook(message) {
        this._updateOrderbookSide(this._bids, message.Buys)
        this._updateOrderbookSide(this._asks, message.Sells)

        if(message.Sells.length > 0 || message.Buys.length > 0) {
            this.emit('orderbookUpdated')
        }
    }

    _updateOrderbookSide(side, entries) {
        _.each(entries, (entry) => {
            _.remove(side, (sideEntry) => { sideEntry[0] == entry.Rate })
            if(entry.Type !== 1) side.push([entry.Rate, entry.Quantity])
        })
    }

    _processDeltaMessage(deltaMessage) {
        if(!this._initialized) {
            this._deltaQueue.push(deltaMessage)
        }
        else {
            this._updateOrderbook(deltaMessage)
            this._publishFills(deltaMessage.Fills)
        }
    }
}

module.exports = Market