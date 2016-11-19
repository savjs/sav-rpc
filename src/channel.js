/*
 * @Description     通信信道
 * @File       channel.js
 * @Auth       jetiny@hfjy.com
 */

import { isObject, isFunction, isPromiseLike } from 'sav-util'

/**
 * 通信信道
 * @param {Object} options 选项
 * @example
 *  // 创建一个通道端口
  let channelA = new Channel({
    channel: 'demo',  // 信道
    name: 'channelA',  // 实例名称
    // 自动绑定(可选)
    receiver: window, // 接收器
  });
  channelA.on('test', function (data) {
    console.log(data);
    return Promise.resolve('world');
  });

  // 另一个通道端口
  let channelB = new Channel({
    channel: 'demo',
    name: 'channelB',
  });
  channelB.listen(window);  // 手动设置监听器
  let sender = channelB.createSender(window)
  sender.send('test', 'hello', function (err, data) {
    console.log(data);
  });
  sender.sendThen('test', 'hello').then(function(data){
    console.log(data);
  })

  // 绑定Flux 方式
  channelA.on('dispatch', flux.dispatch)
  sender.dispatch('test', 'hello')

 */
export function Channel (options) {
  this._actions = {}
  this._callbacks = {}
  this._receiver = null
  this._cid = 0
  options || (options = {})
  this._origin = options.origin || '*' // 源
  this._channel = options.channel
  this._name = options.name
  options.receiver && this.listen(options.receiver)
}

/**
 * 开始监听
 * @param  {Object} handle 监听对象(一般为window)
 */
Channel.prototype.listen = function (handle) {
  this.unlisten()
  let receiver = handle ? makeReceiver(handle) : handle
  if (receiver) {
    receiver.connect(this._recv.bind(this))
    this._receiver = receiver
  }
}

/**
 * 取消监听
 */
Channel.prototype.unlisten = function () {
  if (this._receiver) {
    this._receiver.disconnect()
    this._receiver = null
  }
}

/**
 * 创建
 * @param  {Object} handle 监听对象(一般为window)
 */
Channel.prototype.createSender = function (handle) {
  return new Sender(this, handle)
}

/**
 * 绑定事件消息
 * @param  {String}   action 消息名称
 * @param  {Function} fn     回调
 */
Channel.prototype.on = function (action, fn) {
  this._actions[action] = fn
}

/**
 * 取消事件消息绑定
 * @param  {String} action 消息名称
 */
Channel.prototype.off = function (action) {
  delete this._actions[action]
}

/**
 * 绑定一次性事件消息
 * @param  {String}   action 消息名称
 * @param  {Function} fn     回调
 */
Channel.prototype.once = function (action, fn) {
  let proxy = () => {
    delete this._actions[action]
    fn.apply(null, arguments)
  }
  this._actions[action] = proxy
}

const CALLBACK_ACTION = '__CALLBACK__'

Channel.prototype._recv = function (recv, source) {
  if (!isObject(recv)) { // 只接收object
    return
  }
  if (recv.channel !== this._channel) { // 只接收当前通道的
    return
  }
  if (recv.from === this._name) { // 不接收自己发出的
    return
  }
  let action = recv.action
  if (action === CALLBACK_ACTION) { // 回调
    let cdata = this._callbacks[recv.cid]
    let rdata = recv.data || {}
    if (cdata) {
      let cb = cdata.cb
      if (!cdata.listen) { // 持久监听
        delete this._callbacks[recv.cid]
      }
      cb(rdata.error, rdata.data)
    }
  } else { // 消息
    let act = this._actions[action]
    let self = this
    let next = function (err, data) {
      if (recv.cid) { // 需要反馈
        let newErr = err
        if (err instanceof Error) {
          newErr = {
            message: err.message
          }
        }
        self._sendTo(makeSender(source), CALLBACK_ACTION, {
          error: err && newErr,
          data: data
        }, recv.cid)
      }
    }
    try {
      if (!act) {
        throw new Error('channel "' + this._channel + '.' + this._name + '.' + action + '" not found')
      }
      let ret = act(recv.data)
      if (isPromiseLike(ret)) { // Promise
        return ret.then(function (data) {
          next(null, data)
        }).catch(function (err) {
          next(err)
        })
      } else { // 正常回调
        return next(null, ret)
      }
    } catch (err) { // 异常处理
      return next(err)
    }
  }
}

Channel.prototype._sendTo = function (sender, action, data, cb, keepAlive) {
  let ret = {
    data: data,
    channel: this._channel,
    from: this._name,
    cid: undefined,
    action: action
  }
  if (cb) {
    if (isFunction(cb)) {
      this._callbacks[ret.cid = ++this._cid] = {
        cb: cb,
        keepAlive: keepAlive
      }
    } else {
      ret.cid = cb
    }
  }
  sender.send(ret, this._origin)
}

function makeReceiver (handle) {
  let proxyFn
  if (handle.removeEventListener) {
    return {
      connect: function (fn) {
        proxyFn = function (e) {
          e.data && fn(e.data, e.source)
        }
        handle.addEventListener('message', proxyFn)
      },
      disconnect: function () {
        handle.removeEventListener('message', proxyFn)
      }
    }
  }
};

function makeSender (handle) {
  if (handle.postMessage) {
    return {
      send: function (data, origin) {
        handle.postMessage(data, origin)
      }
    }
  } else if (handle.sendToHost) { // electron WebView
    return {
      send: function (data) {
        handle.sendToHost('message', data)
      }
    }
  } else if (handle.send) { // electron WebView
    return {
      send: function (data) {
        handle.send('message', data)
      }
    }
  }
}

function Sender (owner, handle) {
  this._sender = makeSender(handle)
  this._owner = owner
}

Sender.prototype.send = function (action, data, cb, keepAlive) {
  this._owner._sendTo(this._sender, action, data, cb, keepAlive)
}

/**
 * 发送消息, 返回Promise对象
 * @param  {String}    action    消息名称
 * @param  {Mixed}     data      数据体
 * @param  {Boolean}   keepAlive 是否持久监听
 * @return {Promise}         返回Promise对象
 */
Sender.prototype.sendThen = function (action, data, keepAlive) {
  return new Promise(function (resolve, reject) {
    this.send(action, data, function (err, data) {
      if (err) {
        return reject(err)
      }
      resolve(data)
    })
  }.bind(this))
}

/**
 * FLUX兼容调用方式
 * @param  {String} method  方法名称
 * @param  {Mixed} payload 数据
 * @return {Promise}         返回Promise对象
 */
Sender.prototype.dispatch = function (method, payload) {
  return this.sendThen('dispatch', {
    action: method,
    payload: payload
  })
}
