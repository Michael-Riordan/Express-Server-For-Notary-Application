const express = require('express');
const axios = require('axios');
const cors = require('cors');
const bodyParser = require('body-parser');
const connection = require('./db');
const app = express();
require('dotenv').config();
const port = 8000;


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

app.get('/appointment', (req, res) => {
    res.send('list of all appointments');
})

app.post('/addAppointment', (req, res) => {
    const ADD_QUERY = `insert into notaryappointmentmanager.appointments (appointment) values ('${req.body.appointment}')`
    connection.query(ADD_QUERY, (err) => {
        if (err) {
            console.log(err);
        } else {
            res.send('appointment has been added');
        }
    })
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

