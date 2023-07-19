const express = require('express');
const axios = require('axios');
const cors = require('cors');
const bodyParser = require('body-parser');
const connection = require('./db');
const bcrypt = require('bcrypt');
const { error } = require('console');
const app = express();
const path = require('path');
const fs = require('fs');
const { isUtf8 } = require('buffer');
require('dotenv').config();
const port = 8000;
const businessHoursFilePath = path.join(__dirname, 'business-hours.json');
const blockedDatesFilePath = path.join(__dirname, 'blocked-dates.json');
app.use(express.static(path.dirname(businessHoursFilePath)));
app.use(express.static(path.dirname(blockedDatesFilePath)));


function logger(req, res, next) { 
    console.log(`[${Date.now()}] ${req.method} ${req.url}`);
    next();
}

app.use(logger);

app.use(cors());

app.use(bodyParser.json());


app.get('/api/places', async (req, res) => {
    const apiKey = process.env.PLACES_API_KEY;
    try {
        const query = req.query.query;
        const response = await axios.get(`https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${query}&components=country:US&key=${apiKey}`)
        res.json(response.data);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error'});
    }
});

app.get('/api/distance', async (req, res) => {
    const apiKey = process.env.PLACES_API_KEY;
    try {
        const destination = req.query.query;
        const response = await axios.get(`https://maps.googleapis.com/maps/api/directions/json?origin=${process.env.ADDRESS_ORIGIN}&destination=place_id:${destination}&key=${apiKey}`);
        res.json(response.data);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Most likely cause being distance not yet set' });
    }
});

app.get('/appointments', (req, res) => {
    const APPOINTMENT_QUERY = "select * from notaryappointmentmanager.appointments"
    connection.query(APPOINTMENT_QUERY, (err, response) => {
        if (err) {
            console.log(err)
        } else {
            res.send(response);
        }
    })
})

app.post('/addAppointment', (req, res) => {
    const ADD_QUERY = `insert into notaryappointmentmanager.appointments (appointmentTime, appointmentDate) values ('${req.body.appointmentTime}', '${req.body.appointmentDate}')`
    connection.query(ADD_QUERY, (err) => {
        if (err) {
            console.log(err);
        } else {
            res.send('appointment added');
        }
    })
})

app.delete('/deleteAppointment/:appointmentId', (req, res) => {
    const DELETE_QUERY = `DELETE FROM notaryappointmentmanager.appointments where (appointmentId=${req.params.appointmentId})`;
    connection.query(DELETE_QUERY, (err, res) => {
        if (err) {
            console.log(err);
        }
    });
});

app.post('/credentials', (req, res) => {
    const { username, password } = req.body;
    const CREDENTIALS_QUERY = `SELECT password FROM notaryappointmentmanager.credentials WHERE username = ?`;
    const selectParams = [username];
    connection.query(CREDENTIALS_QUERY, selectParams, (err, results) => {
        if (err) {
            console.error('Error querying the database:', error);
            return res.status(500).json({error: 'Internal server error'});
        }

        if (results.length === 0) {
            return res.status(401).json({error: 'Invalid credentials'});
        }

        const storedHashedPassword = results[0].password;
        bcrypt.compare(password, storedHashedPassword, (compareError, isMatch) => {
            if (compareError) {
                console.error('Error comparing passwords:', compareError);
                return res.status(500).json({ error: 'Internal Server Error'});
            }

            if (!isMatch) {
                return res.status(401).json({error: 'Invalid Credentials'});
            }

            return res.status(200).json({ message: 'Login Successful' });
        })
    });
});

app.get('/api/business-hours', (req, res) => {
    res.sendFile(businessHoursFilePath);
})

app.get('/api/blocked-dates', (req, res) => {
    res.sendFile(blockedDatesFilePath);
})

app.post('/update-hours', (req, res) => {
    const jsonHours = fs.readFileSync('./business-hours.json', 'utf8');
    const jsonArray = JSON.parse(jsonHours);
    const {day, time} = req.body;

    const targetObject = jsonArray.find(obj => obj.hasOwnProperty(day));

    targetObject[day].push(time);
    fs.writeFileSync('./business-hours.json', JSON.stringify(jsonArray));

    res.sendFile(businessHoursFilePath);
})

app.post('/delete-hours', (req, res) => {
    const jsonHours = fs.readFileSync('./business-hours.json', 'utf8');
    const jsonArray = JSON.parse(jsonHours);

    const {day, time} = req.body;

    const targetObject = jsonArray.find(obj => obj.hasOwnProperty(day));

    targetObject[day] = targetObject[day].filter(hour => hour !== time);

    fs.writeFileSync('./business-hours.json', JSON.stringify(jsonArray));

    res.sendFile(businessHoursFilePath);
})

app.post('/updateBlockedDates', (req, res) => {
    const { blockedDates } = req.body;
    const jsonDates = fs.readFileSync('./blocked-dates.json');
    const datesArray = JSON.parse(jsonDates);

    datesArray[0].Blocked = datesArray[0].Blocked.concat(blockedDates);
    fs.writeFileSync('./blocked-dates.json', JSON.stringify(datesArray));

    res.sendFile(blockedDatesFilePath);
})

app.post('/deleteSelectedDates', (req, res) => {
    const { blockedDates } = req.body;
    const jsonDates = fs.readFileSync('./blocked-dates.json');
    const datesArray = JSON.parse(jsonDates);

    datesArray[0].Blocked = datesArray[0].Blocked.filter(date => !blockedDates.includes(date));
    fs.writeFileSync('./blocked-dates.json', JSON.stringify(datesArray));

    res.sendFile(blockedDatesFilePath);
})


/* EIA api call if needed in future. (tracks cost of gasoline in PADD 5 region)
app.get('/api/eia', async (req, res) => {
    const apiKey = process.env.EIA_API_KEY;
    try {
        const response = await axios.get(`https://api.eia.gov/v2/petroleum/pri/gnd/data/?api_key=${apiKey}&frequency=weekly&data[0]=value&facets[series][]=EMM_EPMRR_PTE_R5XCA_DPG&sort[0][column]=period&sort[0][direction]=desc&offset=0&length=1`);
        res.json(response.data);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});*/

app.listen(port, () => {
    console.log(`Server running on port ${port}`)
});

