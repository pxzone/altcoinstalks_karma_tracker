// ==UserScript==
// @name         Forum Karma Tracker
// @namespace    karma-tracker
// @description  Tracks users' karma on Altcoinstalks
// @version      1.0
// @match        *://www.altcoinstalks.com/*
// @grant        GM_xmlhttpRequest
// @connect      pxzone.online
// ==/UserScript==

(function() {
    'use strict';

    console.log('[KarmaTracker] Script loaded');

    function isOwnProfilePage() {
        return (
            document.querySelector('span.firstlevel')?.textContent.includes('Modify Profile') ||
            [...document.querySelectorAll('h4.catbg')]
                .some(el => el.textContent.includes('Modify Profile'))
        );
    }


    // ---------- Detect UID ----------
    let MY_UID = localStorage.getItem('my_uid');

    if (!MY_UID && isOwnProfilePage()) {
        let link = document.querySelector('a[href*="action=profile"][href*=";u="]');
        if (link) {
            let match = link.href.match(/;u=(\d+)/);
            if (match) {
                MY_UID = match[1];
                localStorage.setItem('my_uid', MY_UID);
                console.log('[KarmaTracker] UID detected safely:', MY_UID);
            }
        }
    }

    let TOKEN = localStorage.getItem('karma_token');
    // ---------- Ensure token exists ----------
    let isFetchingToken = false;

    function ensureToken(callback) {
        if (TOKEN) return callback();

        if (isFetchingToken) {
            console.log('[KarmaTracker] Token fetch already in progress...');
            return;
        }

        if (!MY_UID) {
            console.warn('[KarmaTracker] No UID, cannot get token');
            return;
        }

        isFetchingToken = true;

        console.log('[KarmaTracker] Fetching token...');

        GM_xmlhttpRequest({
            method: "POST",
            url: "https://pxzone.online/api/v1/karma/get_token",
            headers: {
                "Content-Type": "application/json",
                "X-Requested-With": "XMLHttpRequest"
            },
            data: JSON.stringify({ giver_uid: MY_UID }),
            onload: function(res) {
                isFetchingToken = false;

                try {
                    let json = JSON.parse(res.responseText);

                    if (json.token) {
                        TOKEN = json.token;
                        localStorage.setItem('karma_token', TOKEN);
                        console.log('[KarmaTracker] Token stored:', TOKEN);

                        callback(); // ✅ only call ONCE
                    } else {
                        console.warn('[KarmaTracker] No token returned');
                    }

                } catch(e) {
                    console.error('[KarmaTracker] Token parse error', e);
                }
            },
            onerror: function() {
                isFetchingToken = false;
                console.error('[KarmaTracker] Token request failed');
            }
        });
    }

    function parseSmfParams(url) {
        let parts = url.split(';');
        let params = {};
        parts.forEach(p => {
            if(p.includes('=')) {
                let [k,v] = p.split('=');
                params[k] = v;
            }
        });
        return params;
    }

    // ---------- Send payload to API ----------
    function sendPayload(urlString) {
        ensureToken(function() {

            let params = parseSmfParams(urlString);

            let payload = {
                giver_uid: MY_UID,
                token: TOKEN,
                receiver_uid: params.uid,
                topic_id: (params.topic||'').split('.')[0],
                post_id: params.m,
                type: params.sa === 'applaud' ? 'positive' : 'negative',
                created_at: new Date().toISOString()
            };

            console.log('[KarmaTracker] Sending:', payload);

            GM_xmlhttpRequest({
                method: "POST",
                url: "https://pxzone.online/api/v1/karma/save",
                headers: { "Content-Type": "application/json" },
                data: JSON.stringify(payload),
                onload: function(res) {
                    try {
                        let json = JSON.parse(res.responseText);
                        if (json.token) {
                            localStorage.setItem('karma_token', json.token);
                        }
                    } catch(e){}
                    console.log('[KarmaTracker] Saved:', res.status);
                }
            });

        });
    }

    // ---------- Store multiple karma clicks ----------
    function addPendingKarma(url) {
        let pending = JSON.parse(localStorage.getItem('pending_karma') || '[]');
        pending.push(url);
        localStorage.setItem('pending_karma', JSON.stringify(pending));
    }

    // ---------- Intercept karma clicks ----------
    document.addEventListener('click', function(e) {
        let link = e.target.closest('a');
        if(!link || !link.href.includes('action=modifykarma')) return;

        console.log('[KarmaTracker] Click detected:', link.href);
        addPendingKarma(link.href);
    }, true);

    // ---------- After page load, process all pending karma ----------
    window.addEventListener('load', function() {
        let pending = JSON.parse(localStorage.getItem('pending_karma') || '[]');
        pending.forEach(url => {
            console.log('[KarmaTracker] Logging karma attempt:', url);
            sendPayload(url); // backend will handle 10-hour check
        });
        localStorage.removeItem('pending_karma');
    });

    /* ---------- Only run on profile statistics page ---------- */
    if (!location.href.includes('action=profile') || !location.href.includes('area=statistics')) {
        return;
    }

    console.log('[KarmaTracker UI] Checking profile page...');

    /* ---------- Check if "Modify Profile" exists (means it's the user) ---------- */
    let isOwnProfile = isOwnProfilePage();

    if (!isOwnProfile) {
        console.log('[KarmaTracker UI] Not your profile, skipping');
        return;
    }

    console.log('[KarmaTracker UI] Own profile detected');

    /* ---------- Get UID ---------- */
    if (!MY_UID) {
        console.warn('[KarmaTracker UI] No UID found');
        return;
    }

    /* ---------- Find insertion point ---------- */
    let targetDiv = document.querySelector('.flow_hidden');
    if (!targetDiv) {
        console.warn('[KarmaTracker UI] flow_hidden not found');
        return;
    }

    /* ---------- Create container ---------- */
    let container = document.createElement('div');
    container.className = 'sent_karma_log';
     container.innerHTML = `
    <div id="karma_header" style="display:flex; justify-content:space-between; align-items:center; margin: 20px 0px 10px 0px;">
        <h3 style="margin:0;">Sent Karma Logs. Detected UID: ${MY_UID}</h3>
        <button id="reset_uid_btn" style="cursor:pointer; border-radius: 3px; border: .7px solid #a6c2dd; padding: 3px 5px;">Reset UID</button>
    </div>
    <div id="karma_table_content">
        <p>Loading...</p>
    </div>
   `;


    let parent = targetDiv.parentElement;
    parent.insertAdjacentElement('afterend', container);

    /* ---------- Fetch data from API ---------- */
    ensureToken(function() {
        GM_xmlhttpRequest({
            method: "GET",
            url: `https://pxzone.online/api/v1/karma/history?token=${TOKEN}`,
            onload: function(res) {
                try {
                    let data = JSON.parse(res.responseText);

                    if (!data || data.length === 0) {
                        let tableDiv = container.querySelector('#karma_table_content');
                        tableDiv.innerHTML = '<p>No records found.</p>';
                        return;
                    }

                    let html = `
                        <table border="0" cellpadding="5" style="border-collapse:collapse; width:100%; background: #a7b5c4; ;border-radius: 5px; ">
                            <thead>
                                <tr>
                                    <th style="color: #fff; font-size: 13.5px">Date</th>
                                    <th style="color: #fff; font-size: 13.5px">Username</th>
                                    <th style="color: #fff; font-size: 13.5px">Type</th>
                                    <th style="color: #fff; font-size: 13.5px">Topic</th>
                                </tr>
                            </thead>
                            <tbody style="background: #f0f4f7;">
                    `;

                    data.forEach(row => {
                        html += `
                            <tr>
                                <td>${row.created_at}</td>
                                <td><a target="_blank" href="https://www.altcoinstalks.com/index.php?action=profile;u=${row.receiver_uid}">${row.username}</a></td>
                                <td style="font-weight: bold;">${row.type}</td>
                                <td><a target="_blank" href="https://www.altcoinstalks.com/index.php?topic=${row.topic_id}.msg${row.post_id};topicseen#msg${row.post_id}">${row.topic_name}</a></td>
                            </tr>
                        `;
                    });

                    html += '</tbody></table>';
                    let tableDiv = container.querySelector('#karma_table_content');
                    tableDiv.innerHTML = html;

                } catch (e) {
                    console.error('[KarmaTracker UI] Parse error:', e);
                    let tableDiv = container.querySelector('#karma_table_content');
                    tableDiv.innerHTML = '<p>Error loading data</p>';
                }
            },
            onerror: function(err) {
                console.error('[KarmaTracker UI] Request error:', err);
                let tableDiv = container.querySelector('#karma_table_content');
                tableDiv.innerHTML = '<p>Failed to load data</p>';
            }
        });
    });


    let reset_btn = container.querySelector('#reset_uid_btn');
    if (reset_btn) {
        reset_btn.addEventListener('click', function() {
            localStorage.removeItem('my_uid');
            alert('UID cleared. Reloading...');
            location.reload();
        });
    }
})();
