var vertices = [];
var width;
var height;
var mediaXMult;
var mediaYMult;

class Vertex{
	constructor(){
		this.x = random(0, window.innerWidth);
		this.y = random(0, window.innerHeight);
		this.radius = random(3,10);
	}
	draw(){
		noStroke();
		fill('rgba(255,255,255,1)');
		circle(this.x,this.y,this.radius);
	}
	update(){
		
	}
	drawEdgesWithinX(threshold){
		for (vertex of vertices){
			if (!(vertex === this)){
				var dist = Math.sqrt(Math.pow((vertex.x-this.x),2) + Math.pow((vertex.y-this.y),2));
				if (dist < threshold){
					stroke('rgba(255,255,255,0.5)');
					strokeWeight(1);
					line(this.x,this.y,vertex.x,vertex.y);
				}
			}
		}
	}
	drawNearestXEdges(x){
		var nearest = [];
		var nearestValues = [];
		for (var i = 0; i<vertices.length; i++){
			if (! (vertices[i] === this)){
				var dist = Math.sqrt(Math.pow((vertices[i].x-this.x),2) + Math.pow((vertices[i].y-this.y),2));
				if (nearest.length < x){
					nearest.push(vertices[i]);
					nearestValues.push(dist);
				} else {
					for (var j = 0; j<x; j++){
						if (dist < nearestValues[j]){
							nearest.splice(j, 1, vertices[i]);
							nearestValues.splice(j, 1, dist);
							break;
						}
					}
				}
			}
		} 
		for (var i = 0; i<nearest.length; i++){
			stroke('rgba(255,255,255,0.5)');
			strokeWeight(1);
			line(this.x,this.y,nearest[i].x,nearest[i].y);
		}
	}
	drawEdges(){
		// this.drawEdgesWithinX(50);
		this.drawNearestXEdges(2);
	}
}


function setup(){
	
	width = window.innerWidth;
	height = window.innerHeight;
	createCanvas(width, height);
	for (var i=0; i<20; i++){
		vertices.push(new Vertex);
	}
}

function draw(){
	background('#0f0f0f');
	// pick a feature detector
	for (vertex of vertices){
		vertex.draw();
		vertex.update();
		vertex.drawEdges();
	}
}



function getFeatures(features)
{
	
}

window.onload = async function(){
	const media = await Speedy.camera();
	mediaXMult = window.innerWidth/media.width;
	mediaYMult = window.innerHeight/media.height;
	const featureDetector = Speedy.FeatureDetector.FAST();
	// set its sensitivity
	featureDetector.sensitivity = 0.5;
	// set enhancements
	featureDetector.enhance({
		illumination: 1
	});
	async function loop(){
		const features = await featureDetector.detect(media);
		vertices = [];
		for(let feature of features) {
			var vertex = new Vertex;
			vertex.x = feature.x*mediaXMult;
			vertex.y = feature.y*mediaYMult;
			if (feature.scale>3){
				vertex.radius = 15;
			} else {
				vertex.radius = feature.scale*5;
			}
			vertices.push(vertex);
		}
		requestAnimationFrame(loop);
	}
	loop();
}


