var chart1 = {
    labels : ["6.1 C1", "6.1 C1 NC", "6.1 C10", "6.1 C10 NC","6.2 C10","6.1 C100","6.1 C100 NC"],
    datasets : [
        {
            fillColor : "rgba(220,220,220,0.5)",
            strokeColor : "rgba(220,220,220,1)",
            data : [119,34,189,61,192,205,62]
        },
        {
            fillColor : "rgba(151,187,205,0.5)",
            strokeColor : "rgba(151,187,205,1)",
            data : [732,90,1694,180,802,1636,150]
        }
    ]

}

var myLine1 = new Chart(document.getElementById("chart1").getContext("2d")).Bar(chart1);

var chart2 = {
    labels : ["6.1 C1", "6.1 C1 NC", "6.1 C10", "6.1 C10 NC","6.2 C10","6.1 C100","6.1 C100 NC"],
    datasets : [
        {
            fillColor : "rgba(220,220,220,0.5)",
            strokeColor : "rgba(220,220,220,1)",
            data : [0.12,0.41,0.72,2.21,0.73,5.35,7.87]
        },
        {
            fillColor : "rgba(151,187,205,0.5)",
            strokeColor : "rgba(151,187,205,1)",
            data : [0.02,0.16,0.09,0.78,0.19,0.83,6.53]
        }
    ]

}

var myLine2 = new Chart(document.getElementById("chart2").getContext("2d")).Bar(chart2);