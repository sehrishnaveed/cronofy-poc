// Import the dependencies
var Cronofy = require('cronofy');
const dotenv = require("dotenv");
const express = require("express");
const bodyParser = require("body-parser");
var moment = require('moment-timezone');
var uniqid = require('uniqid');

var allowCrossDomain = function(req, res, next) {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE');
    res.header('Access-Control-Allow-Headers', 'Content-Type');

    next();
};

// Enable dotenv
dotenv.config();

// Setup
const PORT = 7070;
const origin = "http://localhost:7070";

let localStorage;
if (typeof localStorage === "undefined" || localStorage === null) {
    var LocalStorage = require('node-localstorage').LocalStorage;
    localStorage = new LocalStorage('./scratch');
}

// Setup Express
const app = express();
app.set("view engine", "ejs");
app.set("views", process.cwd() + "/app/templates");
app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.static(__dirname + "/"));
app.use(allowCrossDomain);

// Add the Cronofy client setup here
var cronofyClient = new Cronofy({
    client_id: process.env.CLIENT_ID,
    client_secret: process.env.CLIENT_SECRET,
});

function setAuthTokenInfo(authToken) {
    localStorage.setItem('auth_token_detail', JSON.stringify(authToken));
}

function getAuthTokenInfo() {
    return JSON.parse(localStorage.getItem('auth_token_detail'));
}

function getAccessToken() {
    const authDetail = JSON.parse(localStorage.getItem('auth_token_detail'));
    return authDetail.access_token;
}

function getRefreshToken() {
    const authDetail = JSON.parse(localStorage.getItem('auth_token_detail'));
    return authDetail.refresh_token;
}

function setCalendarsList(calendarInfo) {
    localStorage.setItem('calendar_info', JSON.stringify(calendarInfo));
}

function getFirstCalendarId() {
    const calendarInfo = JSON.parse(localStorage.getItem('calendar_info'));
    return calendarInfo[0].calendar_id;
}

async function refreshAccessToken() {
    const result = await cronofyClient.refreshAccessToken({
        grant_type: 'refresh_token',
        refresh_token: getRefreshToken(),
    });

    const authTokenInfo = getAuthTokenInfo();
    authTokenInfo.access_token = result.access_token;
    authTokenInfo.refresh_token = result.refresh_token;
    setAuthTokenInfo(authTokenInfo);
}

function convertDateToTimeStamp(dateText) {
    return moment(moment.utc(dateText)).unix();
}

async function isSlotAvailable(accessToken, calendarId, slot) {
    const cronofyClient2 = new Cronofy({
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        access_token: accessToken,
    });

    // add 1 day in end date as API does not include event occurring on "to" date.
    const toDateString = moment(moment(moment.utc(slot.end)).toDate()).add(1, 'days').format('YYYY-MM-DD');

    const result = await cronofyClient2.freeBusy({
        from: slot.start,
        to: `${toDateString}T05:00:00Z`,
        tzid: moment.tz.guess(),
        include_managed: true,
        calendar_ids: [
            calendarId,
        ]
    });

    // console.log('free-busy slots', result);
    const events = result.free_busy;

    const slotStart = convertDateToTimeStamp(slot.start);
    const slotEnd = convertDateToTimeStamp(slot.end);

    const filtered = events.filter(event => {
        if (event.free_busy_status === 'busy') {
            const eventStart = convertDateToTimeStamp(event.start);
            const eventEnd = convertDateToTimeStamp(event.end);

            // console.log('event start | event end', eventStart, eventEnd);
            // console.log('slot start | slot end', slotStart, slotEnd);
            // console.log('-----------------------------------------');

            if (slotStart >= eventStart && slotStart < eventEnd) {
                console.log('slot start clash');
                return true;
            }

            if (slotEnd > eventStart && slotEnd < eventEnd) {
                console.log('slot end clash');
                return true;
            }
        }
        return false;
    });

    if (filtered.length > 0) {
        console.log('booked slot', filtered);
        return false;
    }
    return true;
}

const helperMethod = {
    isSlotAvailable: isSlotAvailable,
};

// Route: home
app.get("/", async (req, res) => {

    // Extract the "code" from the page's query string:
    const codeFromQuery = req.query.code;

    if (codeFromQuery) {
        const codeResponse = await cronofyClient.requestAccessToken({
            client_id: process.env.CLIENT_ID,
            client_secret: process.env.CLIENT_SECRET,
            grant_type: "authorization_code",
            code: codeFromQuery,
            redirect_uri: origin
        });

        setAuthTokenInfo(codeResponse);
        getAuthTokenInfo();

        // set calendar id
        const cronofyClient2 = new Cronofy({
            client_id: process.env.CLIENT_ID,
            client_secret: process.env.CLIENT_SECRET,
            access_token: getAccessToken(),
        });
        const userInfo = await cronofyClient2.userInfo();
        setCalendarsList(userInfo['cronofy.data'].profiles[0].profile_calendars);
    }

    await refreshAccessToken();

    // element token generation
    const token = await cronofyClient.requestElementToken({
        version: "1",
        permissions: ["account_management", "managed_availability"],
        subs: [process.env.SUB],
        origin: origin
    });

    return res.render("home", {
        element_token: token.element_token.token,
        client_id: process.env.CLIENT_ID,
        origin: origin,
    });
});

// Route: availability
app.get("/availability", async (req, res) => {
    // Availability code goes here
    const todayDate = new Date();
    const startDate = moment(todayDate, 'DD-MM-YYYY')
        .add(1, 'days')
        .format('YYYY-MM-DD');
    const endDate = moment(new Date(), 'DD-MM-YYYY')
        .add(30, 'days')
        .format('YYYY-MM-DD');

    const token = await cronofyClient.requestElementToken({
        version: "1",
        permissions: ["availability"],
        subs: [process.env.SUB],
        origin: origin
    });

    return res.render("availability", {
        element_token: token.element_token.token,
        sub: process.env.SUB,
        start_date: startDate + "T00:00:00Z",
        end_date: endDate + "T23:59:59Z",
        helperMethod: helperMethod,
    });
});

// Route: submit
app.get("/submit", async (req, res) => {

    // Get the `slot` data from the query string
    const slot = JSON.parse(req.query.slot);
    const title = req.query.title;
    const desc = req.query.desc;

    await refreshAccessToken();

    const accessToken = getAccessToken();
    const calendarId = getFirstCalendarId();

    const cronofyClient2 = new Cronofy({
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        access_token: accessToken,
    });

    if (!await isSlotAvailable(accessToken, calendarId, slot)) {
        console.log('This slot is not available. Please select another slot');
        return;
    }

    cronofyClient2.createEvent({
        calendar_id: calendarId,
        event_id: "booking_demo_event" + uniqid(),
        summary: title || 'Book an event',
        description: desc || 'event description goes here',
        start: slot.start,
        end: slot.end
    });

    const meetingDate = moment(slot.start).format("DD MMM YYYY");
    const start = moment(slot.start).format("LT");
    const end = moment(slot.end).format("LT");

    return res.render("submit", {
        meetingDate,
        start,
        end
    });
});


app.listen(PORT);
console.log(`serving on ${origin}`);


