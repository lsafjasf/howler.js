'use strict';

var harness = require('./webaudio-mock').createHarness();
var assert = require('assert');
var settle = require('./webaudio-mock').settle;

harness.install();
var howler = require('../../src/howler.core.js');
var Howler = howler.Howler;
var Howl = howler.Howl;

var source = 'data:audio/wav;base64,AAAA';
var tests = [];

function test(name, fn) {
  tests.push({name: name, fn: fn});
}

function begin() {
  if (Howler._howls.length) {
    Howler._howls.slice().forEach(function(howl) {
      howl.unload();
    });
  }
  harness.reset();
  Howler.ctx = harness.context;
  Howler.masterGain = harness.context.createGain();
  Howler.masterGain.connect(harness.context.destination);
  Howler.usingWebAudio = true;
  Howler.noAudio = false;
  Howler.autoUnlock = false;
  Howler._audioUnlocked = false;
  Howler._unlocking = false;
  Howler.state = 'running';
}

function create(options) {
  var props = {
    src: [source],
    preload: true
  };
  Object.keys(options || {}).forEach(function(key) {
    props[key] = options[key];
  });
  return new Howl(props);
}

function finishLoad(howl, duration) {
  var request = harness.context.decodeRequests.shift();
  assert(request, 'expected a pending decode request');
  request.success({duration: duration === undefined ? 1 : duration});
  harness.clock.flush();
}

function starts(howl) {
  return harness.calls.filter(function(call) {
    return call.name === 'start';
  });
}

function logEvents(howl, events) {
  var log = [];
  events.forEach(function(event) {
    howl.on(event, function(id) {
      log.push({event: event, id: id});
    });
  });
  return log;
}

test('parallel sprite ids keep independent playback and events', function() {
  begin();
  var howl = create({
    sprite: {
      first: [0, 100],
      second: [200, 100]
    }
  });
  var events = logEvents(howl, ['play', 'end']);
  finishLoad(howl, 1);

  var first = howl.play('first');
  var second = howl.play('second');
  harness.clock.flush();

  assert.notStrictEqual(first, second);
  assert.strictEqual(starts(howl).length, 2);
  assert.strictEqual(starts(howl)[0].offset, 0);
  assert.strictEqual(starts(howl)[0].duration, 0.1);
  assert.strictEqual(starts(howl)[1].offset, 0.2);
  assert.deepStrictEqual(events.slice(0, 2), [
    {event: 'play', id: first},
    {event: 'play', id: second}
  ]);

  harness.clock.advance(100);
  assert.deepStrictEqual(events.map(function(item) {
    return item.event;
  }), ['play', 'play', 'end', 'end']);
  assert.strictEqual(events.filter(function(item) {
    return item.event === 'play';
  }).length, 2);
  assert.strictEqual(events.filter(function(item) {
    return item.event === 'end';
  }).length, 2);
});

test('pausing one parallel sound id leaves the other id running', function() {
  begin();
  var howl = create({
    sprite: {
      first: [0, 100],
      second: [200, 100]
    }
  });
  var events = logEvents(howl, ['play', 'pause', 'end']);
  finishLoad(howl, 1);
  var first = howl.play('first');
  var second = howl.play('second');
  harness.clock.flush();

  harness.clock.advance(20);
  howl.pause(first);
  harness.clock.flush();
  assert.strictEqual(howl.playing(first), false);
  assert.strictEqual(howl.playing(second), true);

  harness.clock.advance(80);
  assert.deepStrictEqual(events.map(function(item) {
    return item.event;
  }), ['play', 'play', 'pause', 'end']);
  assert.strictEqual(events[events.length - 1].id, second);
});

test('sprite loop toggles forward and backward without stale sources', function() {
  begin();
  var howl = create({
    sprite: {
      short: [100, 50, true]
    }
  });
  var events = logEvents(howl, ['play', 'pause']);
  finishLoad(howl, 1);

  var id = howl.play('short');
  harness.clock.flush();
  assert.strictEqual(events.length, 1);
  assert.strictEqual(starts(howl)[0].loop, true);

  harness.clock.advance(20);
  howl.loop(false, id);
  harness.clock.flush();
  var second = starts(howl)[1];
  assert(second);
  assert.strictEqual(second.loop, false);
  assert(second.offset > 0.11 && second.offset < 0.13);
  assert(second.duration > 0.02 && second.duration < 0.04);

  harness.clock.advance(10);
  howl.loop(true, id);
  harness.clock.flush();
  var third = starts(howl)[2];
  assert(third);
  assert.strictEqual(third.loop, true);
  assert(third.offset > 0.12 && third.offset < 0.14);
  assert.strictEqual(third.duration, 86400);
  assert.strictEqual(events.length, 1, 'internal loop restarts must not emit pause/play');
});

test('seeking a looping sprite at its end restarts a real source', function() {
  begin();
  var howl = create({
    loop: true,
    sprite: {
      short: [100, 50]
    }
  });
  var events = logEvents(howl, ['play', 'pause', 'end']);
  finishLoad(howl, 1);
  var id = howl.play('short');
  harness.clock.flush();
  harness.clock.advance(10);

  howl.seek(0.15, id);
  harness.clock.flush();

  assert.strictEqual(starts(howl).length, 2);
  assert.strictEqual(starts(howl)[1].offset, 0.1);
  assert.strictEqual(starts(howl)[1].loop, true);
  assert.strictEqual(events.filter(function(item) {
    return item.event === 'play';
  }).length, 1);
  assert.strictEqual(events.filter(function(item) {
    return item.event === 'end';
  }).length, 0);
});

test('seek before load lands on the decoded buffer only once', function() {
  begin();
  var howl = create({
    sprite: {
      clip: [0, 500]
    }
  });
  var events = logEvents(howl, ['play', 'seek']);
  var id = howl.play('clip');
  assert.strictEqual(howl.seek(0.25, id), howl);
  assert.strictEqual(howl.seek(id), 0.25);

  finishLoad(howl, 1);
  assert.strictEqual(starts(howl).length, 1);
  assert.strictEqual(starts(howl)[0].offset, 0.25);
  assert.strictEqual(events.filter(function(item) {
    return item.event === 'seek';
  }).length, 1);
  assert.strictEqual(events.filter(function(item) {
    return item.event === 'play';
  }).length, 1);
});

test('pause during fade cancels ramp and keeps one pause event', function() {
  begin();
  var howl = create();
  var events = logEvents(howl, ['play', 'pause', 'fade']);
  finishLoad(howl, 1);

  var id = howl.play();
  harness.clock.flush();
  howl.fade(1, 0, 100, id);
  harness.clock.advance(25);
  howl.pause(id);
  harness.clock.flush();

  assert.strictEqual(events.filter(function(item) {
    return item.event === 'play';
  }).length, 1);
  assert.strictEqual(events.filter(function(item) {
    return item.event === 'pause';
  }).length, 1);
  assert.strictEqual(events.filter(function(item) {
    return item.event === 'fade';
  }).length, 1);
  assert.strictEqual(Howler.ctx.currentTime, 0.025);

  harness.clock.advance(500);
  assert(harness.clock.pending().length >= 0);
});

test('visibility recovery resumes once and preserves the buffer offset', async function() {
  begin();
  var howl = create();
  var events = logEvents(howl, ['play', 'pause']);
  finishLoad(howl, 1);
  var id = howl.play();
  harness.clock.flush();

  harness.clock.advance(250);
  assert(howl.seek(id) > 0.2499);
  harness.document.hidden = true;
  harness.document.visibilityState = 'hidden';
  harness.document.dispatch('visibilitychange');
  harness.context.state = 'suspended';
  harness.clock.advance(250);

  harness.document.hidden = false;
  harness.document.visibilityState = 'visible';
  harness.document.dispatch('visibilitychange');
  harness.document.dispatch('visibilitychange');
  await settle();
  harness.clock.flush();

  assert.strictEqual(harness.context.resumeCalls, 1);
  assert.strictEqual(events.length, 1);
  assert(howl.seek(id) > 0.4999 && howl.seek(id) < 0.5001);
});

test('duplicate play calls while resuming produce one play and one source', async function() {
  begin();
  var howl = create();
  var events = logEvents(howl, ['play', 'pause']);
  finishLoad(howl, 1);

  harness.context.state = 'suspended';
  Howler.state = 'suspended';
  var id = howl.play();
  assert.strictEqual(howl.play(id), id);
  await settle();
  harness.clock.flush();

  assert.strictEqual(starts(howl).length, 1);
  assert.deepStrictEqual(events, [{event: 'play', id: id}]);
});

test('repeated decode failures emit loaderror once', function() {
  begin();
  var errors = 0;
  var howl = create({
    onloaderror: function() {
      errors++;
    }
  });
  var request = harness.context.decodeRequests.shift();
  request.error();
  request.error();
  harness.clock.flush();

  assert.strictEqual(errors, 1);
  assert.strictEqual(howl._loadError, true);
});

test('unload during fade cancels timers and never touches removed nodes', function() {
  begin();
  var howl = create();
  var events = logEvents(howl, ['play', 'pause', 'fade']);
  finishLoad(howl, 1);
  var id = howl.play();
  harness.clock.flush();
  howl.fade(1, 0, 200, id);
  harness.clock.advance(25);

  howl.unload();
  harness.clock.flush();
  var callsAfterUnload = harness.calls.length;
  harness.clock.advance(1000);
  harness.document.dispatch('visibilitychange');
  assert.strictEqual(howl.play(), null);
  howl.pause(id);
  howl.fade(0, 1, 100, id);
  harness.clock.flush();

  assert.strictEqual(harness.calls.length, callsAfterUnload);
  assert.strictEqual(events.filter(function(item) {
    return item.event === 'play';
  }).length, 1);
  assert.strictEqual(events.filter(function(item) {
    return item.event === 'fade';
  }).length, 1);
  assert.strictEqual(howl.state(), 'unloaded');
});

test('mobile unlock emits once when touch events overlap playback resume', async function() {
  begin();
  Howler.autoUnlock = true;
  var howl = create();
  var events = logEvents(howl, ['unlock', 'play']);
  finishLoad(howl, 1);
  harness.context.state = 'suspended';
  Howler.state = 'suspended';
  howl.play();

  harness.document.dispatch('touchstart');
  harness.document.dispatch('touchstart');
  assert.strictEqual(harness.context.createdSources.length, 1);

  harness.context.createdSources[0].onended();
  await settle();
  harness.clock.flush();
  harness.document.dispatch('click');

  assert.strictEqual(events.filter(function(item) {
    return item.event === 'unlock';
  }).length, 1);
  assert.strictEqual(events.filter(function(item) {
    return item.event === 'play';
  }).length, 1);
  assert.strictEqual(harness.context.createdSources.length, 2);
});

test('short sprite ends once at its exact boundary', function() {
  begin();
  var howl = create({
    sprite: {
      tick: [0, 5]
    }
  });
  var events = logEvents(howl, ['play', 'end']);
  finishLoad(howl, 1);
  howl.play('tick');
  harness.clock.flush();
  harness.clock.advance(20);

  assert.strictEqual(events.filter(function(item) {
    return item.event === 'play';
  }).length, 1);
  assert.strictEqual(events.filter(function(item) {
    return item.event === 'end';
  }).length, 1);
  assert.strictEqual(starts(howl).length, 1);
});

test('interrupted visibility rebuilds the source at its actual offset', async function() {
  begin();
  var howl = create();
  var events = logEvents(howl, ['play', 'pause']);
  finishLoad(howl, 1);
  var id = howl.play();
  harness.clock.flush();
  harness.clock.advance(100);

  harness.context.state = 'interrupted';
  harness.document.hidden = true;
  harness.document.dispatch('visibilitychange');
  harness.clock.now = 0;
  harness.document.hidden = false;
  harness.document.dispatch('visibilitychange');
  await settle();
  harness.clock.flush();

  assert.strictEqual(starts(howl).length, 2);
  assert(starts(howl)[1].offset > 0.0999 && starts(howl)[1].offset < 0.1001);
  assert.strictEqual(events.filter(function(item) {
    return item.event === 'play';
  }).length, 1);
  assert.strictEqual(events.filter(function(item) {
    return item.event === 'pause';
  }).length, 0);
});

test('consecutive load and unload calls ignore stale decode callbacks', function() {
  begin();
  var errors = 0;
  for (var i=0; i<3; i++) {
    var howl = create({
      onloaderror: function() {
        errors++;
      }
    });
    howl.load();
    var first = harness.context.decodeRequests.shift();
    var second = harness.context.decodeRequests.shift();
    assert(first && second);
    howl.unload();
    first.success({duration: 1});
    second.success({duration: 1});
    first.error();
    second.error();
  }

  harness.clock.flush();
  harness.clock.advance(1000);
  assert.strictEqual(errors, 0);
  assert.strictEqual(starts(null).length, 0);
  assert.strictEqual(harness.context.createdSources.length, 0);
});

(async function run() {
  var failures = 0;
  for (var i = 0; i < tests.length; i++) {
    try {
      await tests[i].fn();
      console.log('ok - ' + tests[i].name);
    } catch (error) {
      failures++;
      console.error('not ok - ' + tests[i].name);
      console.error(error && error.stack || error);
    }
  }
  if (failures) {
    process.exitCode = 1;
  } else {
    console.log('\n' + tests.length + ' WebAudio tests passed');
  }
}());
