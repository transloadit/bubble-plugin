function(properties, context) {
  //Load any data 

 window.Uppy.pick({
  target: 'body',
  maxNumberOfFiles: 1,
  params: {
    auth: { key: context.keys['AUTH KEY'] },
    template_id: context.keys['TEMPLATE ID']
  },
   waitForEncoding:true
})
.then((bundle) => {
}).then(res=>res.json())
  .then(res => console.log(res));
   
  //bundle.transloadit // Array of Assembly statuses
  //bundle.results // Array of all Assembly results
}