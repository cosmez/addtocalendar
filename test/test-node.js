/**
 * Node.js validation script — compares output against expected formats.
 * Run: node test/test-node.js
 */

var path = require('path');

// Minimal DOM stubs to load the library
var _handlers = {};
var window = global;
window.open = function (url) { return url; };
window.navigator = {};
var document = {
    readyState: 'complete',
    addEventListener: function (evt, fn) { _handlers[evt] = fn; },
    querySelectorAll: function () { return []; },
    createElement: function (tag) {
        return {
            className: '', style: {}, textContent: '', innerHTML: '',
            setAttribute: function () {}, appendChild: function () {},
            addEventListener: function () {}, parentNode: null
        };
    },
    head: { appendChild: function () {} },
    getElementsByTagName: function () { return [{ appendChild: function () {} }]; },
    body: { appendChild: function () {}, removeChild: function () {} }
};
global.document = document;
global.URL = { createObjectURL: function () { return 'blob:test'; }, revokeObjectURL: function () {} };
global.Blob = function (parts) { this.content = parts[0]; };
global.setTimeout = function (fn) { fn(); };

// Load the library
var fs = require('fs');
var libPath = path.join(__dirname, '..', 'addtocalendar.js');
var src = fs.readFileSync(libPath, 'utf8');
eval(src);

// Extract internal functions for testing
var testModule = {};
var modifiedSrc = src
    .replace('(function (window, document) {', '(function (window, document, _exports) {')
    .replace('})(window, document);', `
    _exports.parseEventDate = parseEventDate;
    _exports.localToUTC = localToUTC;
    _exports.buildGoogleURL = buildGoogleURL;
    _exports.buildYahooURL = buildYahooURL;
    _exports.buildHotmailURL = buildHotmailURL;
    _exports.buildOffice365URL = buildOffice365URL;
    _exports.buildOutlookWebURL = buildOutlookWebURL;
    _exports.generateICS = generateICS;
    _exports.formatLocalCompact = formatLocalCompact;
    _exports.formatDateOnly = formatDateOnly;
    _exports.addDays = addDays;
    _exports.getDSTTransitionDate = getDSTTransitionDate;
    _exports.isDST = isDST;
    _exports.getUTCOffsetMinutes = getUTCOffsetMinutes;
    _exports.generateVTIMEZONE = generateVTIMEZONE;
    _exports.TIMEZONE_DATA = TIMEZONE_DATA;
    })(window, document, testModule);`);

eval(modifiedSrc);

var T = testModule;

// =========================================================================
console.log('\n=== Date Parser Tests ===');
// =========================================================================

var d1 = T.parseEventDate('3/15/2026 9:00:00 AM');
console.log('Parse "3/15/2026 9:00:00 AM":', JSON.stringify(d1));
console.assert(d1.year === 2026 && d1.month === 3 && d1.day === 15 && d1.hours === 9 && d1.minutes === 0, 'FAIL: timed date parse');

var d2 = T.parseEventDate('03/20/2026');
console.log('Parse "03/20/2026":', JSON.stringify(d2));
console.assert(d2.year === 2026 && d2.month === 3 && d2.day === 20 && d2.hours === 0, 'FAIL: date-only parse');

var d3 = T.parseEventDate('3/15/2026 5:00:00 PM');
console.log('Parse "3/15/2026 5:00:00 PM":', JSON.stringify(d3));
console.assert(d3.hours === 17, 'FAIL: PM parse should be 17, got ' + d3.hours);

var d4 = T.parseEventDate('12/31/2026 12:00:00 PM');
console.log('Parse "12/31/2026 12:00:00 PM":', JSON.stringify(d4));
console.assert(d4.hours === 12, 'FAIL: 12 PM should stay 12');

var d5 = T.parseEventDate('1/1/2027 12:00:00 AM');
console.log('Parse "1/1/2027 12:00:00 AM":', JSON.stringify(d5));
console.assert(d5.hours === 0, 'FAIL: 12 AM should be 0');

console.log('All date parser tests passed.');

// =========================================================================
console.log('\n=== Timezone Tests ===');
// =========================================================================

// DST transition dates for 2026
var dstStart2026 = T.getDSTTransitionDate(2026, T.TIMEZONE_DATA['America/Chicago'].dstStartRule);
console.log('DST starts 2026:', JSON.stringify(dstStart2026));
console.assert(dstStart2026.month === 3 && dstStart2026.day === 8, 'FAIL: 2nd Sunday of March 2026 should be March 8');

var dstEnd2026 = T.getDSTTransitionDate(2026, T.TIMEZONE_DATA['America/Chicago'].dstEndRule);
console.log('DST ends 2026:', JSON.stringify(dstEnd2026));
console.assert(dstEnd2026.month === 11 && dstEnd2026.day === 1, 'FAIL: 1st Sunday of November 2026 should be Nov 1');

// Mar 15 is after DST starts (March 8), so should be CDT (-300)
var offset_mar15 = T.getUTCOffsetMinutes('America/Chicago', { year: 2026, month: 3, day: 15, hours: 9, minutes: 0, seconds: 0 });
console.log('UTC offset Mar 15 (should be -300 CDT):', offset_mar15);
console.assert(offset_mar15 === -300, 'FAIL: Mar 15 should be CDT (-300), got ' + offset_mar15);

// Jan 10 should be CST (-360)
var offset_jan10 = T.getUTCOffsetMinutes('America/Chicago', { year: 2026, month: 1, day: 10, hours: 12, minutes: 0, seconds: 0 });
console.log('UTC offset Jan 10 (should be -360 CST):', offset_jan10);
console.assert(offset_jan10 === -360, 'FAIL: Jan 10 should be CST (-360), got ' + offset_jan10);

// UTC conversion: Mar 15 9:00 AM CDT -> 14:00 UTC
var utc1 = T.localToUTC({ year: 2026, month: 3, day: 15, hours: 9, minutes: 0, seconds: 0 }, 'America/Chicago');
console.log('9:00 AM CDT -> UTC:', JSON.stringify(utc1));
console.assert(utc1.hours === 14, 'FAIL: 9 AM CDT should be 14:00 UTC, got ' + utc1.hours);

// UTC conversion: Mar 15 5:00 PM CDT -> 22:00 UTC
var utc2 = T.localToUTC({ year: 2026, month: 3, day: 15, hours: 17, minutes: 0, seconds: 0 }, 'America/Chicago');
console.log('5:00 PM CDT -> UTC:', JSON.stringify(utc2));
console.assert(utc2.hours === 22, 'FAIL: 5 PM CDT should be 22:00 UTC, got ' + utc2.hours);

console.log('All timezone tests passed.');

// =========================================================================
console.log('\n=== VTIMEZONE Generation ===');
// =========================================================================

var vtz = T.generateVTIMEZONE('America/Chicago', 2026);
console.log(vtz);
console.assert(vtz.indexOf('TZID:America/Chicago') !== -1, 'FAIL: missing TZID');
console.assert(vtz.indexOf('TZNAME:CST') !== -1, 'FAIL: missing CST');
console.assert(vtz.indexOf('TZNAME:CDT') !== -1, 'FAIL: missing CDT');
console.assert(vtz.indexOf('TZOFFSETFROM:-0500') !== -1, 'FAIL: missing STANDARD TZOFFSETFROM');
console.assert(vtz.indexOf('TZOFFSETTO:-0600') !== -1, 'FAIL: missing STANDARD TZOFFSETTO');
console.log('VTIMEZONE tests passed.');

// =========================================================================
console.log('\n=== Google URL Test (Timed Event) ===');
// =========================================================================

var timedEvent = {
    summary: 'Annual Company Retreat',
    description: 'Join us for the annual company retreat. Please confirm your attendance.',
    location: '500 Conference Dr, Austin, TX 73301',
    startParsed: { year: 2026, month: 3, day: 15, hours: 9, minutes: 0, seconds: 0 },
    endParsed: { year: 2026, month: 3, day: 15, hours: 17, minutes: 0, seconds: 0 },
    isAllDay: false,
    timezone: 'America/Chicago'
};

var googleURL = T.buildGoogleURL(timedEvent);
console.log('Generated:', googleURL);

console.assert(googleURL.indexOf('text=Annual') !== -1, 'FAIL: missing text param');
console.assert(googleURL.indexOf('dates=20260315T090000/20260315T170000') !== -1, 'FAIL: wrong dates');
console.assert(googleURL.indexOf('ctz=America%2FChicago') !== -1 || googleURL.indexOf('ctz=America/Chicago') !== -1, 'FAIL: missing ctz');
console.assert(googleURL.indexOf('sf=true') !== -1, 'FAIL: missing sf');
console.assert(googleURL.indexOf('output=xml') !== -1, 'FAIL: missing output');
console.log('Google URL test passed.');

// =========================================================================
console.log('\n=== Hotmail URL Test (Timed Event) ===');
// =========================================================================

var hotmailURL = T.buildHotmailURL(timedEvent);
console.log('Generated:', hotmailURL);

// Mar 15 9:00 AM CDT = 14:00 UTC, 5:00 PM CDT = 22:00 UTC
console.assert(hotmailURL.indexOf('startdt=2026-03-15T14%3A00%3A00Z') !== -1 || hotmailURL.indexOf('startdt=2026-03-15T14:00:00Z') !== -1, 'FAIL: wrong startdt, URL: ' + hotmailURL);
console.assert(hotmailURL.indexOf('enddt=2026-03-15T22%3A00%3A00Z') !== -1 || hotmailURL.indexOf('enddt=2026-03-15T22:00:00Z') !== -1, 'FAIL: wrong enddt');
console.assert(hotmailURL.indexOf('allday=false') !== -1, 'FAIL: missing allday=false');
console.assert(hotmailURL.indexOf('rru=addevent') !== -1, 'FAIL: missing rru');
console.log('Hotmail URL test passed.');

// =========================================================================
console.log('\n=== Office 365 URL Test (Timed Event) ===');
// =========================================================================

var office365URL = T.buildOffice365URL(timedEvent);
console.log('Generated:', office365URL);

console.assert(office365URL.indexOf('outlook.office.com') !== -1, 'FAIL: wrong base domain');
console.assert(office365URL.indexOf('startdt=2026-03-15T14%3A00%3A00Z') !== -1 || office365URL.indexOf('startdt=2026-03-15T14:00:00Z') !== -1, 'FAIL: wrong startdt');
console.assert(office365URL.indexOf('rru=addevent') !== -1, 'FAIL: missing rru');
console.log('Office 365 URL test passed.');

// =========================================================================
console.log('\n=== ICS Generation Test (Timed Event) ===');
// =========================================================================

var ics = T.generateICS(timedEvent);
console.log(ics);

console.assert(ics.indexOf('BEGIN:VCALENDAR') !== -1, 'FAIL: missing VCALENDAR');
console.assert(ics.indexOf('BEGIN:VTIMEZONE') !== -1, 'FAIL: missing VTIMEZONE');
console.assert(ics.indexOf('TZID:America/Chicago') !== -1, 'FAIL: missing TZID');
console.assert(ics.indexOf('DTSTART;TZID=America/Chicago:20260315T090000') !== -1, 'FAIL: wrong DTSTART');
console.assert(ics.indexOf('DTEND;TZID=America/Chicago:20260315T170000') !== -1, 'FAIL: wrong DTEND');
console.assert(ics.indexOf('SUMMARY:Annual Company Retreat') !== -1, 'FAIL: wrong SUMMARY');
console.assert(ics.indexOf('TRANSP:OPAQUE') !== -1, 'FAIL: missing TRANSP');
console.assert(ics.indexOf('STATUS:CONFIRMED') !== -1, 'FAIL: missing STATUS');
console.assert(ics.indexOf('SEQUENCE:0') !== -1, 'FAIL: missing SEQUENCE');
console.assert(ics.indexOf('X-MICROSOFT-CDO-BUSYSTATUS:BUSY') !== -1, 'FAIL: missing BUSYSTATUS');
console.assert(ics.indexOf('X-ALT-DESC;FMTTYPE=text/html:') !== -1, 'FAIL: missing X-ALT-DESC');
console.assert(ics.indexOf('LOCATION:500 Conference Dr') !== -1, 'FAIL: wrong LOCATION');
console.assert(ics.indexOf('END:VCALENDAR') !== -1, 'FAIL: missing END:VCALENDAR');
console.log('ICS timed event test passed.');

// =========================================================================
console.log('\n=== ICS Generation Test (All-Day Event) ===');
// =========================================================================

var allDayEvent = {
    summary: 'Product Launch Day',
    description: 'Mark your calendar for the product launch. Details to follow.',
    location: '500 Conference Dr, Austin, TX 73301',
    startParsed: { year: 2026, month: 3, day: 20, hours: 0, minutes: 0, seconds: 0 },
    endParsed: { year: 2026, month: 3, day: 20, hours: 0, minutes: 0, seconds: 0 },
    isAllDay: true,
    timezone: 'America/Chicago'
};

var icsAllDay = T.generateICS(allDayEvent);
console.log(icsAllDay);

console.assert(icsAllDay.indexOf('DTSTART;VALUE=DATE:20260320') !== -1, 'FAIL: wrong all-day DTSTART');
console.assert(icsAllDay.indexOf('DTEND;VALUE=DATE:20260321') !== -1, 'FAIL: wrong all-day DTEND (should be +1 day)');
console.log('ICS all-day event test passed.');

// =========================================================================
console.log('\n=== Google URL Test (All-Day Event) ===');
// =========================================================================

var googleAllDay = T.buildGoogleURL(allDayEvent);
console.log('Generated:', googleAllDay);
console.assert(googleAllDay.indexOf('dates=20260320/20260321') !== -1, 'FAIL: wrong all-day Google dates');
console.assert(googleAllDay.indexOf('ctz=') === -1, 'FAIL: all-day should not have ctz');
console.log('Google all-day URL test passed.');

// =========================================================================
console.log('\n=== ALL TESTS PASSED ===');
// =========================================================================
