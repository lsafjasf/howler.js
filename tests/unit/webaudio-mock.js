'use strict';

var assert = require('assert');

function Clock() {
  this.now = 0;
  this.nextId = 1;
  this.timers = [];
}

Clock.prototype.setTimeout = function(fn, delay) {
  return this._add(fn, delay, false);
};

Clock.prototype.setInterval = function(fn, delay) {
  return this._add(fn, delay, true);
};

Clock.prototype._add = function(fn, delay, repeat) {
  var timer = {
    id: this.nextId++,
    fn: fn,
    time: this.now + Math.max(0, Number(delay) || 0),
    interval: repeat ? Math.max(1, Number(delay) || 1) : 0,
    cleared: false
  };
  this.timers.push(timer);
  return timer.id;
};

Clock.prototype.clear = function(id) {
  for (var i = 0; i < this.timers.length; i++) {
    if (this.timers[i].id === id) {
      this.timers[i].cleared = true;
    }
  }
};

Clock.prototype._next = function(limit) {
  var next = null;
  for (var i = 0; i < this.timers.length; i++) {
    var timer = this.timers[i];
    if (timer.cleared || timer.time > limit) {
      continue;
    }
    if (!next || timer.time < next.time || timer.time === next.time && timer.id < next.id) {
      next = timer;
    }
  }
  return next;
};

Clock.prototype.advance = function(ms) {
  var limit = this.now + Math.max(0, Number(ms) || 0);
  var timer;

  while ((timer = this._next(limit))) {
    this.now = timer.time;
    if (timer.interval) {
      timer.time += timer.interval;
    } else {
      timer.cleared = true;
    }
    timer.fn();
  }

  this.now = limit;
  this.timers = this.timers.filter(function(item) {
    return !item.cleared;
  });
};

Clock.prototype.flush = function() {
  var timer;
  while ((timer = this._next(this.now))) {
    timer.cleared = true;
    timer.fn();
  }
  this.timers = this.timers.filter(function(item) {
    return !item.cleared;
  });
};

Clock.prototype.pending = function() {
  return this.timers.filter(function(timer) {
    return !timer.cleared;
  });
};

function FakeEventTarget() {
  this.listeners = {};
}

FakeEventTarget.prototype.addEventListener = function(type, fn) {
  this.listeners[type] = this.listeners[type] || [];
  if (this.listeners[type].indexOf(fn) === -1) {
    this.listeners[type].push(fn);
  }
};

FakeEventTarget.prototype.removeEventListener = function(type, fn) {
  var listeners = this.listeners[type] || [];
  var index = listeners.indexOf(fn);
  if (index >= 0) {
    listeners.splice(index, 1);
  }
};

FakeEventTarget.prototype.dispatch = function(type) {
  var listeners = (this.listeners[type] || []).slice();
  for (var i = 0; i < listeners.length; i++) {
    listeners[i].call(this, {type: type, target: this});
  }
};

function AudioParam(clock, calls) {
  this.clock = clock;
  this.calls = calls;
}

AudioParam.prototype.setValueAtTime = function(value, time) {
  this.calls.push({name: 'setValueAtTime', value: value, time: time});
};

AudioParam.prototype.linearRampToValueAtTime = function(value, time) {
  this.calls.push({name: 'linearRampToValueAtTime', value: value, time: time});
};

AudioParam.prototype.cancelScheduledValues = function(time) {
  this.calls.push({name: 'cancelScheduledValues', time: time});
};

function GainNode(clock, calls) {
  this.gain = new AudioParam(clock, calls);
  this.connections = [];
  this.disconnects = 0;
}

GainNode.prototype.connect = function(node) {
  this.connections.push(node);
};

GainNode.prototype.disconnect = function() {
  this.disconnects++;
};

function BufferSource(clock, calls) {
  this.clock = clock;
  this.calls = calls;
  this.buffer = null;
  this.loop = false;
  this.loopStart = 0;
  this.loopEnd = 0;
  this.playbackRate = new AudioParam(clock, calls);
  this.connections = [];
  this.disconnects = 0;
  this.onended = null;
}

BufferSource.prototype.connect = function(node) {
  this.connections.push(node);
};

BufferSource.prototype.disconnect = function() {
  this.disconnects++;
};

BufferSource.prototype.start = function(when, offset, duration) {
  this.calls.push({
    name: 'start',
    at: this.clock.now / 1000,
    when: when,
    offset: offset,
    duration: duration,
    loop: this.loop,
    loopStart: this.loopStart,
    loopEnd: this.loopEnd
  });
};

BufferSource.prototype.stop = function(when) {
  this.calls.push({name: 'stop', when: when});
};

function FakeAudioContext(clock, calls) {
  this.clock = clock;
  this.calls = calls;
  this.sampleRate = 44100;
  this.state = 'running';
  this.destination = {};
  this.decodeRequests = [];
  this.createdSources = [];
  this.resumeCalls = 0;
  this.suspendCalls = 0;
  this.closeCalls = 0;
}

Object.defineProperty(FakeAudioContext.prototype, 'currentTime', {
  get: function() {
    return this.clock.now / 1000;
  }
});

FakeAudioContext.prototype.createGain = function() {
  return new GainNode(this.clock, this.calls);
};

FakeAudioContext.prototype.createBufferSource = function() {
  var source = new BufferSource(this.clock, this.calls);
  this.createdSources.push(source);
  return source;
};

FakeAudioContext.prototype.createBuffer = function() {
  return {duration: 1 / 22050};
};

FakeAudioContext.prototype.decodeAudioData = function(buffer, success, error) {
  this.decodeRequests.push({
    buffer: buffer,
    success: success,
    error: error
  });
};

FakeAudioContext.prototype.resume = function() {
  this.resumeCalls++;
  this.state = 'running';
  return Promise.resolve();
};

FakeAudioContext.prototype.suspend = function() {
  this.suspendCalls++;
  this.state = 'suspended';
  return Promise.resolve();
};

FakeAudioContext.prototype.close = function() {
  this.closeCalls++;
  this.state = 'closed';
  return Promise.resolve();
};

function FakeAudio() {
  this.duration = 0;
  this.currentTime = 0;
  this.paused = true;
  this.muted = false;
  this.volume = 1;
  this.readyState = 4;
  this.error = null;
}

FakeAudio.prototype.canPlayType = function() {
  return 'probably';
};

FakeAudio.prototype.load = function() {};
FakeAudio.prototype.play = function() {
  this.paused = false;
  return Promise.resolve();
};
FakeAudio.prototype.pause = function() {
  this.paused = true;
};
FakeAudio.prototype.addEventListener = function() {};
FakeAudio.prototype.removeEventListener = function() {};

function createHarness() {
  var clock = new Clock();
  var calls = [];
  var context = new FakeAudioContext(clock, calls);
  var document = new FakeEventTarget();
  document.hidden = false;
  document.visibilityState = 'visible';

  return {
    clock: clock,
    calls: calls,
    context: context,
    document: document,
    Audio: FakeAudio,
    reset: function() {
      clock.now = 0;
      clock.nextId = 1;
      clock.timers = [];
      calls.length = 0;
      context.calls = calls;
      context.decodeRequests = [];
      context.createdSources = [];
      context.resumeCalls = 0;
      context.suspendCalls = 0;
      context.closeCalls = 0;
      context.state = 'running';
      document.hidden = false;
      document.visibilityState = 'visible';
    },
    install: function() {
      global.setTimeout = clock.setTimeout.bind(clock);
      global.clearTimeout = clock.clear.bind(clock);
      global.setInterval = clock.setInterval.bind(clock);
      global.clearInterval = clock.clear.bind(clock);
      global.document = document;
      global.window = {
        navigator: {userAgent: 'node-test', platform: 'test', vendor: 'test', appVersion: ''},
        location: {protocol: 'http:'}
      };
      Object.defineProperty(global, 'navigator', {
        configurable: true,
        value: window.navigator
      });
      global.Audio = FakeAudio;
      global.AudioContext = function() {
        return context;
      };
      Date.now = function() {
        return clock.now;
      };
    }
  };
}

function settle() {
  return Promise.resolve().then(function() {
    return Promise.resolve();
  });
}

module.exports = {
  createHarness: createHarness,
  settle: settle,
  assert: assert
};
