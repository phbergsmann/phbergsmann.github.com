var chart1 = {
    labels : ["trans/s 10 concurrent", "trans/s 100 concurrent"],
    datasets : [
        {
            fillColor : "rgba(220,220,220,0.5)",
            strokeColor : "rgba(220,220,220,1)",
            data : [12,12]
        },
        {
            fillColor : "rgba(151,187,205,0.5)",
            strokeColor : "rgba(151,187,205,1)",
            data : [592,718]
        }
    ]

}

var myLine1 = new Chart(document.getElementById("chart1").getContext("2d")).Bar(chart1);

var chart2 = {
    labels : ["shortest trans 10 concurrent", "shortest trans 100 concurrent"],
    datasets : [
        {
            fillColor : "rgba(220,220,220,0.5)",
            strokeColor : "rgba(220,220,220,1)",
            data : [0.42,0.43]
        },
        {
            fillColor : "rgba(151,187,205,0.5)",
            strokeColor : "rgba(151,187,205,1)",
            data : [0.00,0.02]
        }
    ]

}

var myLine2 = new Chart(document.getElementById("chart2").getContext("2d")).Bar(chart2);