// Import the dependencies
const Cronofy = require('cronofy');
const dotenv = require("dotenv");
const express = require("express");
const bodyParser = require("body-parser");
const moment = require('moment-timezone');
const uniqid = require('uniqid');
const localStorageHelper = require('./localStorageHelper');
const {
    removeAuthTokenInfo,
    setAuthTokenInfo,
    getAuthTokenInfo,
    getAccessToken,
    setCalendarsList,
    getFirstCalendarId
} = localStorageHelper;

const { logInfo } = require('./logger');


// Enable dotenv
dotenv.config();

// Setup
const PORT = 7070;
const ORIGIN = process.env.ORIGIN;
const REFRESH_TOKEN = process.env.REFRESH_TOKEN;

// Setup Express
const app = express();
app.set("view engine", "ejs");
app.set("views", process.cwd() + "/app/templates");
app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.static(__dirname + "/"));

// Add the Cronofy client setup here
var cronofyClient = new Cronofy({
    client_id: process.env.CLIENT_ID,
    client_secret: process.env.CLIENT_SECRET,
});

// console.log('account info before', getAuthTokenInfo());
// console.log('remove account info', removeAuthTokenInfo());
// console.log('account info after', getAuthTokenInfo());

async function refreshAccessToken() {
    let payload = '';
    try {
        payload = {
            grant_type: 'refresh_token',
            refresh_token: REFRESH_TOKEN,
        };
        // console.log('refreshAccessToken >> payload', payload);
        const result = await cronofyClient.refreshAccessToken(payload);
        // console.log('refreshAccessToken >> result', result);
        setAuthTokenInfo(result);
    }
    catch (err) {
        const context = {
            payload,
            err,
        };
        logInfo('Error! refreshAccessToken() >> Exception Detail', context);
    }
}

function convertDateToTimeStamp(dateText) {
    return moment(moment.utc(dateText)).unix();
}

async function isSlotAvailable(slot) {
    await refreshAccessToken();

    let payload = {
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        access_token: getAccessToken(),
    };
    try {
        const cronofyClient2 = new Cronofy(payload);

        // add 1 day in end date as API does not include event occurring on "to" date.
        const toDateString = moment(moment(moment.utc(slot.end)).toDate()).add(1, 'days').format('YYYY-MM-DD');

        const result = await cronofyClient2.freeBusy({
            from: slot.start,
            to: `${toDateString}T05:00:00Z`,
            tzid: moment.tz.guess(),
            include_managed: true,
            calendar_ids: [
                getFirstCalendarId(),
            ]
        });

        const events = result.free_busy;

        const slotStart = convertDateToTimeStamp(slot.start);
        const slotEnd = convertDateToTimeStamp(slot.end);

        const filtered = events.filter(event => {
            if (event.free_busy_status === 'busy') {
                const eventStart = convertDateToTimeStamp(event.start);
                const eventEnd = convertDateToTimeStamp(event.end);

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
    catch (err) {
        const context = {
            payload,
            err,
        };
        logInfo('Error! isSlotAvailable() >> "freeBusy"! Exception Detail', context);
    }
}


app.get('/checkSlotAvailability', async (req, res) => {
    const isAvailable =  await isSlotAvailable(JSON.parse(req.query.slot));
    res.send({isAvailable});
});

app.get('/createEvent', async (req, res) => {
    try {
        const slot = JSON.parse(req.query.slot);
        const title = req.query.title;
        const desc = req.query.desc;

        await refreshAccessToken();

        const cronofyClient2 = new Cronofy({
            client_id: process.env.CLIENT_ID,
            client_secret: process.env.CLIENT_SECRET,
            access_token: getAccessToken(),
        });

        const result = await cronofyClient2.createEvent({
            calendar_id: getFirstCalendarId(),
            event_id: "booking_demo_event" + uniqid(),
            summary: title || 'Book an event',
            description: desc || 'event description goes here',
            start: slot.start,
            end: slot.end
        });

        res.status(200).send({result});
    }
    catch(err) {

        logInfo('Error! On creating event "createEvent" >> Exception Detail', err);
        res.status(400).send({err});
    }
});


// Route: home
app.get("/", async (req, res) => {

    // Extract the "code" from the page's query string:
    const codeFromQuery = req.query.code;

    if (codeFromQuery) {
        let payload = '';
        try {
            payload = {
                client_id: process.env.CLIENT_ID,
                client_secret: process.env.CLIENT_SECRET,
                grant_type: "authorization_code",
                code: codeFromQuery,
                redirect_uri: ORIGIN
            };
            const codeResponse = await cronofyClient.requestAccessToken(payload);

            setAuthTokenInfo(codeResponse);
        }
        catch(err) {
            const context = {
                payload,
                err,
            };
            logInfo('Error on calling requestAccessTokens! Exception Detail', context);
        }

        // set calendar id
        try {
            payload = {
                client_id: process.env.CLIENT_ID,
                client_secret: process.env.CLIENT_SECRET,
                access_token: getAccessToken(),
            };
            const cronofyClient2 = new Cronofy(payload);
            const userInfo = await cronofyClient2.userInfo();
            setCalendarsList(userInfo['cronofy.data'].profiles[0].profile_calendars);
        }
        catch(err) {
            const context = {
                payload,
                err,
            };
            logInfo('Error! Home Page url '/' >> "userInfo"! Exception Detail', context);
        }

    }

    if (getAuthTokenInfo()) {
        await refreshAccessToken();
    }

    // element token generation
    payload = {
        version: "1",
        permissions: ["account_management", "managed_availability"],
        subs: [process.env.SUB],
        origin: ORIGIN
    };

    try {
        const token = await cronofyClient.requestElementToken(payload);

        return res.render("home", {
            element_token: token.element_token.token,
            client_id: process.env.CLIENT_ID,
            origin: ORIGIN,
        });
    }
    catch(err) {
        const context = {
            payload,
            err,
        };
        logInfo('Error! Home Page url '/' >> "requestElementToken"! Exception Detail', context);
    }
});

// Route: availability
app.get("/availability", async (req, res) => {
    // Availability code goes here

    try {
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
            origin: ORIGIN
        });

        return res.render("availability", {
            element_token: token.element_token.token,
            sub: process.env.SUB,
            start_date: startDate + "T00:00:00Z",
            end_date: endDate + "T23:59:59Z",
            isSlotAvailable: isSlotAvailable,
        });
    }
    catch(err) {
        logInfo('Error! On loading page "/availability" >> Exception Detail', err);
    }


});

// Route: submit
app.get("/submit", async (req, res) => {

    // Get the `slot` data from the query string
    const slot = JSON.parse(req.query.slot);

    try {
        const meetingDate = moment(slot.start).format("DD MMM YYYY");
        const start = moment(slot.start).format("LT");
        const end = moment(slot.end).format("LT");

        return res.render("submit", {
            meetingDate,
            start,
            end
        });
    }
    catch(err) {
        logInfo('Error! On loading event-detail page. Exception Detail', err);
    }

});


app.listen(PORT);
console.log(`serving on ${ORIGIN}`);


