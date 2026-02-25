/**
 * AddToCalendar — Self-hosted calendar widget
 * Drop-in replacement for AddThisEvent  
 * Zero dependencies, 100% client-side
 */
(function (window, document) {
    'use strict';

    // =========================================================================
    // Constants
    // =========================================================================

    var PROVIDER_ORDER = ['outlook', 'google', 'yahoo', 'hotmail', 'ical', 'facebook'];

    // Provider definitions for AddEvent-style icon layout
    var ADDEVENT_PROVIDERS = [
        { key: 'ical',      icon: 'apple.svg',     online: false },
        { key: 'google',    icon: 'google.svg',     online: true },
        { key: 'office365', icon: 'office365.svg',  online: true },
        { key: 'outlook',   icon: 'outlook.svg',    online: false },
        { key: 'hotmail',   icon: 'outlook.svg',    online: true },
        { key: 'yahoo',     icon: 'yahoo.svg',      online: true }
    ];

    // ATE zonecode -> IANA timezone mapping
    var ZONECODE_MAP = {
        11: 'America/Chicago'
    };

    // Timezone definitions with DST rules (US standard)
    var TIMEZONE_DATA = {
        'America/Chicago': {
            standard: { abbr: 'CST', utcOffset: -360, offsetFrom: '-0500', offsetTo: '-0600' },
            daylight: { abbr: 'CDT', utcOffset: -300, offsetFrom: '-0600', offsetTo: '-0500' },
            dstStartRule: { month: 3, nth: 2, weekday: 0, hour: 2 },   // 2nd Sunday of March
            dstEndRule:   { month: 11, nth: 1, weekday: 0, hour: 2 }   // 1st Sunday of November
        },
        'America/New_York': {
            standard: { abbr: 'EST', utcOffset: -300, offsetFrom: '-0400', offsetTo: '-0500' },
            daylight: { abbr: 'EDT', utcOffset: -240, offsetFrom: '-0500', offsetTo: '-0400' },
            dstStartRule: { month: 3, nth: 2, weekday: 0, hour: 2 },
            dstEndRule:   { month: 11, nth: 1, weekday: 0, hour: 2 }
        }
    };

    // =========================================================================
    // Internal State
    // =========================================================================

    var _config = {
        mouse: false,
        css: true,
        style: 'default',    // 'default' or 'addevent' (icon-based layout)
        iconPath: 'img/',     // base path for provider icon SVGs (addevent style)
        outlook:   { show: true, text: 'Outlook Calendar' },
        google:    { show: true, text: 'Google Calendar' },
        yahoo:     { show: true, text: 'Yahoo Calendar' },
        ical:      { show: true, text: 'iCal Calendar' },
        hotmail:   { show: true, text: 'Hotmail Calendar' },
        facebook:  { show: true, text: 'Facebook Calendar' },
        office365: { show: true, text: 'Office 365 Calendar' }
    };

    var _cssInjected = false;
    var _domReady = false;
    var _settingsCalled = false;
    var _initialized = false;
    var _openDropdown = null;

    // =========================================================================
    // Utility: Zero-pad
    // =========================================================================

    function pad(n) {
        return n < 10 ? '0' + n : '' + n;
    }

    // =========================================================================
    // Date Parser
    // =========================================================================

    function parseEventDate(dateStr) {
        if (!dateStr) return { year: 2000, month: 1, day: 1, hours: 0, minutes: 0, seconds: 0 };

        var parts = dateStr.trim().split(/\s+/);
        var datePart = parts[0];
        var timePart = parts.length > 1 ? parts[1] : null;
        var ampm = parts.length > 2 ? parts[2].toUpperCase() : null;

        var datePieces = datePart.split('/');
        var month = parseInt(datePieces[0], 10);
        var day = parseInt(datePieces[1], 10);
        var year = parseInt(datePieces[2], 10);

        var hours = 0, minutes = 0, seconds = 0;

        if (timePart) {
            var timePieces = timePart.split(':');
            hours = parseInt(timePieces[0], 10);
            minutes = timePieces.length > 1 ? parseInt(timePieces[1], 10) : 0;
            seconds = timePieces.length > 2 ? parseInt(timePieces[2], 10) : 0;

            if (ampm === 'PM' && hours !== 12) hours += 12;
            if (ampm === 'AM' && hours === 12) hours = 0;
        }

        return { year: year, month: month, day: day, hours: hours, minutes: minutes, seconds: seconds };
    }

    // =========================================================================
    // Date Arithmetic
    // =========================================================================

    function daysInMonth(year, month) {
        return new Date(year, month, 0).getDate();
    }

    function addDays(parsed, n) {
        var d = new Date(parsed.year, parsed.month - 1, parsed.day + n);
        return {
            year: d.getFullYear(),
            month: d.getMonth() + 1,
            day: d.getDate(),
            hours: parsed.hours,
            minutes: parsed.minutes,
            seconds: parsed.seconds
        };
    }

    // =========================================================================
    // Timezone Engine
    // =========================================================================

    // Get the Nth occurrence of a weekday in a given month/year
    // weekday: 0=Sunday, month: 1-12
    function getNthWeekdayOfMonth(year, month, weekday, nth) {
        var first = new Date(year, month - 1, 1);
        var firstDay = first.getDay();
        var diff = (weekday - firstDay + 7) % 7;
        var day = 1 + diff + (nth - 1) * 7;
        return day;
    }

    function getDSTTransitionDate(year, rule) {
        var day = getNthWeekdayOfMonth(year, rule.month, rule.weekday, rule.nth);
        return { year: year, month: rule.month, day: day, hours: rule.hour, minutes: 0, seconds: 0 };
    }

    // Compare two parsed date objects (same timezone). Returns <0, 0, or >0.
    function compareDates(a, b) {
        if (a.year !== b.year) return a.year - b.year;
        if (a.month !== b.month) return a.month - b.month;
        if (a.day !== b.day) return a.day - b.day;
        if (a.hours !== b.hours) return a.hours - b.hours;
        if (a.minutes !== b.minutes) return a.minutes - b.minutes;
        return a.seconds - b.seconds;
    }

    function isDST(tzData, parsed) {
        var dstStart = getDSTTransitionDate(parsed.year, tzData.dstStartRule);
        var dstEnd = getDSTTransitionDate(parsed.year, tzData.dstEndRule);
        return compareDates(parsed, dstStart) >= 0 && compareDates(parsed, dstEnd) < 0;
    }

    function getUTCOffsetMinutes(timezone, parsed) {
        var tzData = TIMEZONE_DATA[timezone];
        if (!tzData) return -360; // fallback to CST
        return isDST(tzData, parsed) ? tzData.daylight.utcOffset : tzData.standard.utcOffset;
    }

    function localToUTC(parsed, timezone) {
        var offsetMinutes = getUTCOffsetMinutes(timezone, parsed);
        // UTC = local - offset (offset is negative for west of GMT, so subtracting -360 adds 360 min)
        // Use Date.UTC to avoid system timezone interference
        var ms = Date.UTC(
            parsed.year, parsed.month - 1, parsed.day,
            parsed.hours, parsed.minutes - offsetMinutes, parsed.seconds
        );
        var d = new Date(ms);
        return {
            year: d.getUTCFullYear(),
            month: d.getUTCMonth() + 1,
            day: d.getUTCDate(),
            hours: d.getUTCHours(),
            minutes: d.getUTCMinutes(),
            seconds: d.getUTCSeconds()
        };
    }

    function generateVTIMEZONE(timezone, year) {
        var tzData = TIMEZONE_DATA[timezone];
        if (!tzData) return '';

        var dstStart = getDSTTransitionDate(year, tzData.dstStartRule);
        var dstEnd = getDSTTransitionDate(year, tzData.dstEndRule);

        // DTSTART uses the resulting wall-clock time in the destination timezone:
        // STANDARD (fall back): 2 AM CDT -> 1 AM CST, so hour = onset - 1
        // DAYLIGHT (spring forward): 2 AM CST -> 3 AM CDT, so hour = onset + 1
        var standardHour = dstEnd.hours - 1;
        var daylightHour = dstStart.hours + 1;

        var lines = [
            'BEGIN:VTIMEZONE',
            'TZID:' + timezone,
            'BEGIN:STANDARD',
            'DTSTART:' + year + pad(dstEnd.month) + pad(dstEnd.day) + 'T' + pad(standardHour) + '0000',
            'RRULE:FREQ=YEARLY;BYDAY=' + tzData.dstEndRule.nth + 'SU;BYMONTH=' + tzData.dstEndRule.month,
            'TZOFFSETFROM:' + tzData.standard.offsetFrom,
            'TZOFFSETTO:' + tzData.standard.offsetTo,
            'TZNAME:' + tzData.standard.abbr,
            'END:STANDARD',
            'BEGIN:DAYLIGHT',
            'DTSTART:' + year + pad(dstStart.month) + pad(dstStart.day) + 'T' + pad(daylightHour) + '0000',
            'RRULE:FREQ=YEARLY;BYDAY=' + tzData.dstStartRule.nth + 'SU;BYMONTH=' + tzData.dstStartRule.month,
            'TZOFFSETFROM:' + tzData.daylight.offsetFrom,
            'TZOFFSETTO:' + tzData.daylight.offsetTo,
            'TZNAME:' + tzData.daylight.abbr,
            'END:DAYLIGHT',
            'END:VTIMEZONE'
        ];
        return lines.join('\r\n');
    }

    // =========================================================================
    // Date Formatters
    // =========================================================================

    function formatLocalCompact(p) {
        return p.year + pad(p.month) + pad(p.day) + 'T' + pad(p.hours) + pad(p.minutes) + pad(p.seconds);
    }

    function formatDateOnly(p) {
        return p.year + pad(p.month) + pad(p.day);
    }

    function formatUTCCompact(p) {
        return formatLocalCompact(p) + 'Z';
    }

    function formatISO_UTC(p) {
        return p.year + '-' + pad(p.month) + '-' + pad(p.day) + 'T' +
               pad(p.hours) + ':' + pad(p.minutes) + ':' + pad(p.seconds) + 'Z';
    }

    // =========================================================================
    // ICS Generator
    // =========================================================================

    function escapeICSText(str) {
        if (!str) return '';
        return str.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
    }

    function generateUID() {
        return Date.now() + Math.random().toString(36).substr(2, 9) + 'addtocalendar';
    }

    function generateICS(eventData) {
        var now = new Date();
        var dtstamp = now.getUTCFullYear() + pad(now.getUTCMonth() + 1) + pad(now.getUTCDate()) + 'T' +
                      pad(now.getUTCHours()) + pad(now.getUTCMinutes()) + pad(now.getUTCSeconds()) + 'Z';

        var lines = [
            'BEGIN:VCALENDAR',
            'PRODID:-//AddToCalendar//AddToCalendar v1.0//EN',
            'VERSION:2.0'
        ];

        // VTIMEZONE block (always include for consistency)
        lines.push(generateVTIMEZONE(eventData.timezone, eventData.startParsed.year));

        lines.push('BEGIN:VEVENT');
        lines.push('DESCRIPTION:' + escapeICSText(eventData.description));
        lines.push('X-ALT-DESC;FMTTYPE=text/html:' + escapeICSText(eventData.description));
        lines.push('UID:' + generateUID());
        lines.push('SUMMARY:' + escapeICSText(eventData.summary));

        if (eventData.isAllDay) {
            lines.push('DTSTART;VALUE=DATE:' + formatDateOnly(eventData.startParsed));
            lines.push('DTEND;VALUE=DATE:' + formatDateOnly(addDays(eventData.endParsed, 1)));
        } else {
            lines.push('DTSTART;TZID=' + eventData.timezone + ':' + formatLocalCompact(eventData.startParsed));
            lines.push('DTEND;TZID=' + eventData.timezone + ':' + formatLocalCompact(eventData.endParsed));
        }

        lines.push('DTSTAMP:' + dtstamp);
        lines.push('TRANSP:OPAQUE');
        lines.push('STATUS:CONFIRMED');
        lines.push('SEQUENCE:0');
        lines.push('LOCATION:' + escapeICSText(eventData.location));
        lines.push('X-MICROSOFT-CDO-BUSYSTATUS:BUSY');
        lines.push('END:VEVENT');
        lines.push('END:VCALENDAR');

        return lines.join('\r\n');
    }

    function downloadICS(icsString, filename) {
        var blob = new Blob([icsString], { type: 'text/calendar;charset=utf-8' });

        // IE/Edge legacy fallback
        if (window.navigator && window.navigator.msSaveBlob) {
            window.navigator.msSaveBlob(blob, filename);
            return;
        }

        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(function () {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 100);
    }

    // =========================================================================
    // URL Builders
    // =========================================================================

    function buildGoogleURL(eventData) {
        var base = 'https://calendar.google.com/calendar/u/0/r/eventedit';
        var params = [];

        params.push('text=' + encodeURIComponent(eventData.summary));

        if (eventData.isAllDay) {
            var endPlusOne = addDays(eventData.endParsed, 1);
            params.push('dates=' + formatDateOnly(eventData.startParsed) + '/' + formatDateOnly(endPlusOne));
        } else {
            params.push('dates=' + formatLocalCompact(eventData.startParsed) + '/' + formatLocalCompact(eventData.endParsed));
            params.push('ctz=' + encodeURIComponent(eventData.timezone));
        }

        params.push('details=' + encodeURIComponent(eventData.description));
        params.push('location=' + encodeURIComponent(eventData.location));
        params.push('sf=true');
        params.push('output=xml');

        return base + '?' + params.join('&');
    }

    function buildYahooURL(eventData) {
        var base = 'https://calendar.yahoo.com/';
        var params = ['v=60'];

        params.push('title=' + encodeURIComponent(eventData.summary));

        if (eventData.isAllDay) {
            params.push('st=' + formatDateOnly(eventData.startParsed));
            params.push('dur=allday');
        } else {
            var startUTC = localToUTC(eventData.startParsed, eventData.timezone);
            var endUTC = localToUTC(eventData.endParsed, eventData.timezone);
            params.push('st=' + formatUTCCompact(startUTC));
            params.push('et=' + formatUTCCompact(endUTC));
        }

        params.push('desc=' + encodeURIComponent(eventData.description));
        params.push('in_loc=' + encodeURIComponent(eventData.location));

        return base + '?' + params.join('&');
    }

    function buildOutlookWebURL(eventData, base) {
        var params = [];

        params.push('path=' + encodeURIComponent('/calendar/action/compose'));
        params.push('rru=addevent');

        if (eventData.isAllDay) {
            params.push('startdt=' + eventData.startParsed.year + '-' + pad(eventData.startParsed.month) + '-' + pad(eventData.startParsed.day));
            var endPlusOne = addDays(eventData.endParsed, 1);
            params.push('enddt=' + endPlusOne.year + '-' + pad(endPlusOne.month) + '-' + pad(endPlusOne.day));
            params.push('allday=true');
        } else {
            var startUTC = localToUTC(eventData.startParsed, eventData.timezone);
            var endUTC = localToUTC(eventData.endParsed, eventData.timezone);
            params.push('startdt=' + formatISO_UTC(startUTC));
            params.push('enddt=' + formatISO_UTC(endUTC));
            params.push('allday=false');
        }

        params.push('subject=' + encodeURIComponent(eventData.summary));
        params.push('location=' + encodeURIComponent(eventData.location));
        params.push('body=' + encodeURIComponent(eventData.description));

        return base + '?' + params.join('&');
    }

    function buildHotmailURL(eventData) {
        return buildOutlookWebURL(eventData, 'https://outlook.live.com/calendar/0/action/compose/');
    }

    function buildOffice365URL(eventData) {
        return buildOutlookWebURL(eventData, 'https://outlook.office.com/calendar/0/action/compose/');
    }

    function buildFacebookURL(eventData) {
        var base = 'https://www.facebook.com/events/create/';
        var params = [];

        params.push('name=' + encodeURIComponent(eventData.summary));
        params.push('details=' + encodeURIComponent(eventData.description));
        params.push('location=' + encodeURIComponent(eventData.location));

        return base + '?' + params.join('&');
    }

    // =========================================================================
    // DOM Engine
    // =========================================================================

    function parseSpans(anchor) {
        var spanNames = [
            'start', 'end', 'zonecode', 'summary', 'description',
            'location', 'organizer', 'organizer_email', 'all_day_event', 'date_format'
        ];

        var data = {};
        for (var i = 0; i < spanNames.length; i++) {
            var span = anchor.querySelector('._' + spanNames[i]);
            if (span) {
                data[spanNames[i]] = span.textContent.trim();
                span.style.display = 'none';
            } else {
                data[spanNames[i]] = '';
            }
        }

        data.startParsed = parseEventDate(data.start);
        data.endParsed = parseEventDate(data.end);
        data.isAllDay = (data.all_day_event === 'true');
        data.timezone = ZONECODE_MAP[parseInt(data.zonecode, 10)] || 'America/Chicago';

        return data;
    }

    function wrapAnchor(anchor) {
        // Don't re-wrap if already inside an addthisevent-drop
        if (anchor.parentNode && anchor.parentNode.className &&
            anchor.parentNode.className.indexOf('addthisevent-drop') !== -1) {
            return anchor.parentNode;
        }

        var wrapper = document.createElement('div');
        wrapper.className = 'addthisevent-drop';
        anchor.parentNode.insertBefore(wrapper, anchor);
        wrapper.appendChild(anchor);
        return wrapper;
    }

    function createProviderHandler(providerKey, eventData) {
        return function (e) {
            e.preventDefault();
            e.stopPropagation();

            switch (providerKey) {
                case 'google':
                    window.open(buildGoogleURL(eventData), '_blank');
                    break;
                case 'yahoo':
                    window.open(buildYahooURL(eventData), '_blank');
                    break;
                case 'hotmail':
                    window.open(buildHotmailURL(eventData), '_blank');
                    break;
                case 'office365':
                    window.open(buildOffice365URL(eventData), '_blank');
                    break;
                case 'facebook':
                    window.open(buildFacebookURL(eventData), '_blank');
                    break;
                case 'outlook':
                    downloadICS(generateICS(eventData), 'event.ics');
                    break;
                case 'ical':
                    downloadICS(generateICS(eventData), 'event.ics');
                    break;
            }
        };
    }

    function hideDropdown(dropdown) {
        // Remove inline style so CSS default takes over (hidden when css:true)
        dropdown.style.display = '';
    }

    function showDropdown(dropdown) {
        dropdown.style.display = 'block';
    }

    function buildDropdown(eventData) {
        var dropdown = document.createElement('div');
        dropdown.className = 'addthisevent_dropdown';
        // No inline display set — CSS controls initial visibility:
        // css:true → injected CSS hides it; css:false → app CSS controls it

        if (_config.style === 'addevent') {
            dropdown.className += ' addthisevent_dropdown--icons';

            for (var j = 0; j < ADDEVENT_PROVIDERS.length; j++) {
                var prov = ADDEVENT_PROVIDERS[j];
                var cfg = _config[prov.key];
                if (!cfg || !cfg.show) continue;

                var span = document.createElement('span');
                span.setAttribute('data-provider', prov.key);

                var img = document.createElement('img');
                img.src = _config.iconPath + prov.icon;
                img.alt = '';
                img.className = 'addthisevent-icon';
                span.appendChild(img);

                span.appendChild(document.createTextNode(cfg.text + ' '));

                if (prov.online) {
                    var em = document.createElement('em');
                    em.className = 'addthisevent-online';
                    em.textContent = '(online)';
                    span.appendChild(em);
                }

                span.addEventListener('click', createProviderHandler(prov.key, eventData));
                dropdown.appendChild(span);
            }
        } else {
            for (var i = 0; i < PROVIDER_ORDER.length; i++) {
                var key = PROVIDER_ORDER[i];
                var providerCfg = _config[key];

                if (!providerCfg || !providerCfg.show) continue;

                var span = document.createElement('span');
                span.textContent = providerCfg.text;
                span.setAttribute('data-provider', key);
                span.addEventListener('click', createProviderHandler(key, eventData));
                dropdown.appendChild(span);
            }
        }

        return dropdown;
    }

    function attachClickHandler(anchor, dropdown) {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();

            // Toggle: if already open, close it
            if (_openDropdown === dropdown) {
                hideDropdown(dropdown);
                _openDropdown = null;
                return;
            }

            // Close any other open dropdown
            if (_openDropdown) {
                hideDropdown(_openDropdown);
            }

            // Open this one
            showDropdown(dropdown);
            _openDropdown = dropdown;
        });
    }

    function scanAndProcess() {
        var anchors = document.querySelectorAll('a.addthisevent');

        for (var i = 0; i < anchors.length; i++) {
            var anchor = anchors[i];

            if (anchor.getAttribute('data-ate-processed') === 'true') continue;

            var eventData = parseSpans(anchor);
            var wrapper = wrapAnchor(anchor);
            var dropdown = buildDropdown(eventData);
            wrapper.appendChild(dropdown);
            attachClickHandler(anchor, dropdown);

            anchor.setAttribute('data-ate-processed', 'true');
        }
    }

    // Click-outside-to-close (registered once)
    document.addEventListener('click', function (e) {
        if (_openDropdown) {
            var wrapper = _openDropdown.parentNode;
            if (wrapper && !wrapper.contains(e.target)) {
                hideDropdown(_openDropdown);
                _openDropdown = null;
            }
        }
    });

    // =========================================================================
    // CSS Injection
    // =========================================================================

    function injectDefaultCSS() {
        if (_cssInjected) return;

        // Inline SVG calendar icon (no external dependency)
        var calIcon = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16'%3E%3Crect x='1' y='3' width='14' height='12' rx='1' fill='none' stroke='%23888' stroke-width='1.2'/%3E%3Cline x1='1' y1='6.5' x2='15' y2='6.5' stroke='%23888' stroke-width='1.2'/%3E%3Cline x1='4.5' y1='1.5' x2='4.5' y2='4.5' stroke='%23888' stroke-width='1.2' stroke-linecap='round'/%3E%3Cline x1='11.5' y1='1.5' x2='11.5' y2='4.5' stroke='%23888' stroke-width='1.2' stroke-linecap='round'/%3E%3C/svg%3E";

        var css =
            '.addthisevent-drop{' +
                'display:inline-block;' +
                'position:relative;' +
                'z-index:999998;' +
                'font-family:arial,sans-serif;' +
                "background:#f4f4f4 url(\"" + calIcon + "\") no-repeat 9px 50%;" +
                'border:1px solid #d9d9d9;' +
                'color:#555;' +
                'font-weight:bold;' +
                'font-size:14px;' +
                'padding:9px 12px 8px 35px;' +
                'border-radius:2px;' +
                'cursor:pointer;' +
                '-webkit-user-select:none;' +
                '-moz-user-select:none;' +
                '-ms-user-select:none;' +
                'user-select:none;' +
                'text-decoration:none;' +
            '}' +
            '.addthisevent-drop:hover{' +
                'background-color:#e8e8e8;' +
                'border-color:#ccc;' +
            '}' +
            '.addthisevent{' +
                'color:#333 !important;' +
                'text-decoration:none !important;' +
                'cursor:pointer;' +
            '}' +
            '.addthisevent_dropdown{' +
                'display:none;' +
                'position:absolute;' +
                'top:100%;' +
                'left:0;' +
                'width:250px;' +
                'background:#fff;' +
                'text-align:left;' +
                'border-radius:8px;' +
                'box-shadow:0px 0px 10px rgba(0,0,0,0.2);' +
                'font-family:"Segoe UI",Frutiger,"Frutiger Linotype","Dejavu Sans","Helvetica Neue",Arial,sans-serif;' +
                'z-index:999999;' +
            '}' +
            '.addthisevent_dropdown span{' +
                'display:block;' +
                'line-height:110%;' +
                'background:#fff;' +
                'text-decoration:none;' +
                'font-size:14px;' +
                'color:#07ade0;' +
                'cursor:pointer;' +
                'padding:14px 18px 14px 17px;' +
                'border-bottom:1px solid #eee;' +
            '}' +
            '.addthisevent_dropdown span:hover{' +
                'background:#f4f4f4;' +
                'color:#6d84b4;' +
                'text-decoration:none;' +
                'font-size:14px;' +
            '}' +
            '.addthisevent_dropdown span:first-child{' +
                'border-top-left-radius:8px;' +
                'border-top-right-radius:8px;' +
            '}' +
            '.addthisevent_dropdown span:last-child{' +
                'border-bottom-left-radius:8px;' +
                'border-bottom-right-radius:8px;' +
                'border-bottom:none;' +
            '}' +
            '.addthisevent span{' +
                'display:none !important;' +
            '}' +
            '.addthisevent-drop ._url,' +
            '.addthisevent-drop ._start,' +
            '.addthisevent-drop ._end,' +
            '.addthisevent-drop ._summary,' +
            '.addthisevent-drop ._description,' +
            '.addthisevent-drop ._location,' +
            '.addthisevent-drop ._organizer,' +
            '.addthisevent-drop ._organizer_email,' +
            '.addthisevent-drop ._facebook_event,' +
            '.addthisevent-drop ._all_day_event,' +
            '.addthisevent-drop ._date_format,' +
            '.addthisevent-drop ._zonecode{' +
                'display:none !important;' +
            '}' +
            '.addthisevent_dropdown--icons span{' +
                'display:flex;' +
                'align-items:center;' +
                'color:#333;' +
                'font-size:14px;' +
                'padding:12px 16px;' +
            '}' +
            '.addthisevent_dropdown--icons span:hover{' +
                'background:#f4f4f4;' +
                'color:#333;' +
            '}' +
            '.addthisevent-icon{' +
                'width:20px;' +
                'height:20px;' +
                'margin-right:12px;' +
                'flex-shrink:0;' +
            '}' +
            '.addthisevent-online{' +
                'color:#999;' +
                'font-size:12px;' +
                'font-style:normal;' +
                'margin-left:4px;' +
            '}';

        var style = document.createElement('style');
        style.setAttribute('type', 'text/css');
        style.setAttribute('data-ate-css', 'true');
        style.textContent = css;

        if (document.head) {
            document.head.appendChild(style);
        } else {
            document.getElementsByTagName('head')[0].appendChild(style);
        }

        _cssInjected = true;
    }

    // =========================================================================
    // Public API
    // =========================================================================

    function settingsFn(config) {
        if (!config) return;

        if (typeof config.mouse !== 'undefined') _config.mouse = config.mouse;
        if (typeof config.css !== 'undefined') _config.css = config.css;
        if (typeof config.style !== 'undefined') _config.style = config.style;
        if (typeof config.iconPath !== 'undefined') _config.iconPath = config.iconPath;

        var providers = ['outlook', 'google', 'yahoo', 'ical', 'hotmail', 'facebook', 'office365'];
        for (var i = 0; i < providers.length; i++) {
            var key = providers[i];
            if (config[key]) {
                if (typeof config[key].show !== 'undefined') _config[key].show = config[key].show;
                if (typeof config[key].text !== 'undefined') _config[key].text = config[key].text;
            }
        }

        // Apply addevent-style default texts for providers not explicitly configured
        if (_config.style === 'addevent') {
            var addeventTexts = {
                ical: 'Apple', google: 'Google', office365: 'Office 365',
                outlook: 'Outlook', hotmail: 'Outlook.com', yahoo: 'Yahoo'
            };
            for (var k in addeventTexts) {
                if (addeventTexts.hasOwnProperty(k) && (!config[k] || typeof config[k].text === 'undefined')) {
                    _config[k].text = addeventTexts[k];
                }
            }
        }

        _settingsCalled = true;

        if (_config.css) {
            injectDefaultCSS();
        }

        if (_domReady && !_initialized) {
            _initialized = true;
            scanAndProcess();
        }
    }

    function refreshFn() {
        scanAndProcess();
    }

    function autoInit() {
        _domReady = true;

        if (_settingsCalled && !_initialized) {
            _initialized = true;
            scanAndProcess();
            return;
        }

        // If settings() hasn't been called yet, defer to give it a chance
        // (it's typically called in $(document).ready which fires at the same time)
        setTimeout(function () {
            if (!_initialized) {
                _initialized = true;
                scanAndProcess();
            }
        }, 0);
    }

    // =========================================================================
    // Namespace + Init
    // =========================================================================

    var api = {
        settings: settingsFn,
        refresh: refreshFn
    };

    window.addthisevent = api;
    window.addtocalendar = api;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', autoInit);
    } else {
        autoInit();
    }

})(window, document);
