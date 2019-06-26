function(instance, properties, context) {
	var x = document.createElement("VIDEO");

    if (x.canPlayType("video/mp4")) {
        x.setAttribute("src",properties.src);
        x.setAttribute("controls", "controls");
    }
    instance.canvas.appendChild(x);
}