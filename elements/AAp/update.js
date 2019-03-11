function(instance, properties, context) {
	const config = {
        sources: [
          {
            type: 'mp4',
            src: properties.src,
          }
        ],
      };

      //const element = document.getElementById('playerContainer');
      const player = IndigoPlayer.init(instance.canvas, config);

    


}