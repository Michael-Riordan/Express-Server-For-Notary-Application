const mysql = require('mysql2');
require('dotenv').config();

const connectionPool = mysql.createPool({
    connectionLimit: 5,
    host: `${process.env.AMAZON_RDS_ENDPOINT}`,
    port: 3306,
    user: `${process.env.RDS_USERNAME}`,
    password: `${process.env.MYSQL_PASSWORD}`,
    database: 'notaryappointmentmanager',
});

module.exports = connectionPool;