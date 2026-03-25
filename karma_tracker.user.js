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

    // ---------- Detect UID ----------
    let MY_UID = localStorage.getItem('my_uid') || (function(){
        let link = document.querySelector('a[href*="action=profile"][href*=";u="]');
        if (!link) return null;
        let match = link.href.match(/;u=(\d+)/);
        if(match) localStorage.setItem('my_uid', match[1]);
        return match ? match[1] : null;
    })();

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
        let params = parseSmfParams(urlString);
        let payload = {
            giver_uid: MY_UID,
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
            onload: res => console.log('[KarmaTracker] Saved:', res.status),
            onerror: err => console.error('[KarmaTracker] Error:', err)
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
    let isOwnProfile = [...document.querySelectorAll('h4.catbg')]
        .some(el => el.textContent.includes('Modify Profile'));

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
    container.innerHTML = '<h3>Sent Karma Logs. MY UID: '+MY_UID+' </h3><p>Loading...</p>';

    let parent = targetDiv.parentElement;
    parent.insertAdjacentElement('afterend', container);

    /* ---------- Fetch data from API ---------- */
    GM_xmlhttpRequest({
        method: "GET",
        url: `https://pxzone.online/api/v1/karma/history?uid=${MY_UID}`,
        onload: function(res) {
            try {
                let data = JSON.parse(res.responseText);

                if (!data || data.length === 0) {
                    container.innerHTML = '<h2>Sent Karma Logs</h2><p>No records found.</p>';
                    return;
                }

                let html = `
                    <h3 style="margin-top: 25px;">Sent Karma Logs. My UID: ${MY_UID}</h3>
                    <table border="1" cellpadding="5" style="border-collapse:collapse; width:100%;">
                        <thead>
                            <tr>
                                <th>Date</th>
                                <th>Username</th>
                                <th>Type</th>
                                <th>Topic</th>
                            </tr>
                        </thead>
                        <tbody>
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
                container.innerHTML = html;

            } catch (e) {
                console.error('[KarmaTracker UI] Parse error:', e);
                container.innerHTML = '<p>Error loading data</p>';
            }
        },
        onerror: function(err) {
            console.error('[KarmaTracker UI] Request error:', err);
            container.innerHTML = '<p>Failed to load data</p>';
        }
    });

})();
